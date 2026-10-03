// Source-first image dispatch. No v1 decoding, grid construction, finish, revise or retry.
// /api/ai has no account authentication. Eligibility remains the existing IP-based
// quota plus a default-off server flag. Opaque job possession and the originating
// IP hash restrict polling; this is not account authentication or account ownership.
import SceneIRV3 from '../assets/js/scene-ir-v3.js';
import { json } from './shared.mjs';
import { openaiConfig, startJob, fetchJob, readResult } from './openai.mjs';
import { PROMPT_TEXT, CAPABILITIES_TEXT, FREEZE_TEXT } from './scene-ir-v3-packet.mjs';

export const EXTRACTION_CONTRACT = 'scene-ir-v3';
export const V3_PROVIDER_ADAPTER = 'openai-json-v3-source';
const JOB_PREFIX = 'sir3_';
const STORE_PREFIX = 'ai-source-v3/jobs/';
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const SCHEMA_TEXT = JSON.stringify(SceneIRV3.schema, null, 2) + '\n';
const ENCODER = new TextEncoder();
const manifest = JSON.parse(FREEZE_TEXT);

export async function sha256(value) {
  const bytes = typeof value === 'string' ? ENCODER.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

let packetPromise;
export function frozenPacket() {
  if (!packetPromise) packetPromise = (async () => {
    const files = { 'schema-v3.json': SCHEMA_TEXT, 'extraction-prompt-v3.txt': PROMPT_TEXT, 'capabilities-v3.json': CAPABILITIES_TEXT };
    for (const [file, text] of Object.entries(files)) {
      if (await sha256(text) !== manifest.files[file].sha256) throw new Error('Frozen v3 extraction packet mismatch: ' + file);
    }
    return {
      contract: { id: manifest.contract, freezeSha256: await sha256(FREEZE_TEXT), files: manifest.files },
      schemaText: SCHEMA_TEXT, promptText: PROMPT_TEXT, capabilitiesText: CAPABILITIES_TEXT,
    };
  })();
  return packetPromise;
}

export function extractionContractError(payload) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'extractionContract') && payload.extractionContract !== EXTRACTION_CONTRACT) {
    return json({ error: 'unknown_extraction_contract' }, 400);
  }
  return null;
}

function v3Job(value) { return typeof value === 'string' && value.startsWith(JOB_PREFIX); }
export function isSceneIRV3Request(payload) {
  return Boolean(payload && (payload.extractionContract === EXTRACTION_CONTRACT
    || (Array.isArray(payload.jobs) && payload.jobs.some(v3Job))
    || payload.sceneVersion === 3 || (payload.sceneIR && payload.sceneIR.sceneVersion === 3)
    || (Array.isArray(payload.pages) && payload.pages.some(page => page && page.sceneVersion === 3))));
}

function failure(error, status, message) {
  return json({ error, extractionContract: EXTRACTION_CONTRACT, message }, status);
}

export function sceneIRV3Capability(env, quotaCounted) {
  if (!env || env.SCENE_IR_V3_ENABLED !== 'true' || !quotaCounted || !env.AI_QUOTA
      || !env.PLANS || typeof env.PLANS.put !== 'function' || typeof env.PLANS.get !== 'function'
      || env.AI_IMPORT_PROVIDER === 'vertex' || !openaiConfig(env).configured) return {};
  return { sceneIRV3: { enabled: true, extractionContract: EXTRACTION_CONTRACT, structuredOutput: false, maxImages: 1, acceptsHint: false } };
}

async function access(request, env) {
  if (!env || env.SCENE_IR_V3_ENABLED !== 'true') return { error: failure('scene_ir_v3_disabled', 403, 'Experimental source extraction is disabled.') };
  if (!env.PLANS || typeof env.PLANS.put !== 'function' || typeof env.PLANS.get !== 'function') {
    return { error: failure('scene_ir_v3_storage_unavailable', 503, 'Persistent source job storage is required.') };
  }
  // Cloudflare supplies this edge header. Match the existing quota identity and
  // its local-development fallback; do not present an IP hash as account auth.
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  return { subjectHash: await sha256('scene-ir-v3-ip:' + address) };
}

function provider(env) {
  // JSON mode is deliberate, not a fallback. The frozen nested oneOf and optional
  // fields do not satisfy OpenAI's strict Structured Outputs subset (all fields
  // required; documented anyOf). Do not run the lossy legacy toJsonSchema adapter.
  // https://developers.openai.com/api/docs/guides/structured-outputs
  // Exact schema is supplied as text and enforced locally after preserving raw.
  if (env.AI_IMPORT_PROVIDER === 'vertex') return { error: failure('scene_ir_v3_provider_unsupported', 503, 'Only the explicitly unstructured OpenAI JSON adapter is implemented for v3.') };
  const config = openaiConfig(env);
  if (!config.configured) return { error: failure('ai_not_configured', 503, 'OpenAI is not configured.') };
  return { config: { ...config, model: env.OPENAI_MODEL || 'gpt-6-astra', schema: undefined } };
}

function base(record) {
  return {
    extractionContract: EXTRACTION_CONTRACT,
    contract: record.contract,
    structuredOutput: false,
    provenance: {
      provider: 'openai', adapter: V3_PROVIDER_ADAPTER, model: record.model,
      imageSha256: record.imageSha256, imageMimeType: record.imageMimeType,
      rawSha256: record.rawSha256 || null, providerStatus: record.providerStatus || null,
      requestContract: EXTRACTION_CONTRACT,
    },
  };
}

async function writeRecord(env, record) {
  await env.PLANS.put(STORE_PREFIX + record.id + '.json', JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
}

async function readRecord(env, id) {
  const saved = await env.PLANS.get(STORE_PREFIX + id + '.json');
  if (!saved) return null;
  return typeof saved.json === 'function' ? saved.json() : JSON.parse(await saved.text());
}

async function saveProviderResponse(env, record, response) {
  // Save original model text and provider envelope BEFORE JSON.parse/compile.
  // readResult does not normalize JSON, remove fences, rewrite source or retry.
  let result;
  try { result = readResult(response); } catch { result = {}; }
  const outputs = Array.isArray(response.output) ? response.output : [];
  const rawResponse = outputs.flatMap(item => item && Array.isArray(item.content) ? item.content : []).filter(part => part && typeof part.text === 'string').map(part => part.text).join('');
  record.providerResponse = response;
  record.rawResponse = rawResponse;
  record.rawSha256 = await sha256(rawResponse);
  record.providerStatus = response.status || '';
  record.providerIdMismatch = Boolean(record.providerJobId && response.id !== record.providerJobId);
  record.usage = result.usage || null;
  record.completedAt = new Date().toISOString();
  record.state = 'completed';
  await writeRecord(env, record);
}

export async function importSceneIRV3({ payload, env, deps, request, readImage, takeQuota, cost }) {
  // Explicit import contract is required; source-looking fields cannot opt in.
  if (payload.extractionContract !== EXTRACTION_CONTRACT) return failure('scene_ir_v3_contract_required', 400, 'Specify the source extraction contract.');
  const allowed = await access(request, env, deps);
  if (allowed.error) return allowed.error;
  // The packet describes one source image. Multi-page assembly needs its own
  // explicit source contract; silently merging IDs/floors would corrupt facts.
  const images = Array.isArray(payload.images) && payload.images.length ? payload.images : [payload.image];
  if (images.length !== 1) return failure('scene_ir_v3_single_image_required', 400, 'v3 currently accepts exactly one source image.');
  if (payload.hint !== undefined && payload.hint !== '') return failure('scene_ir_v3_hint_unsupported', 400, 'v3 inputs are limited to the frozen packet and original image.');
  if (['schema', 'schemaUrl', 'prompt', 'promptUrl', 'catalog', 'catalogUrl', 'capabilities', 'contract'].some(key => Object.prototype.hasOwnProperty.call(payload, key))) {
    return failure('scene_ir_v3_packet_override', 400, 'Extraction packets are server-owned.');
  }
  const image = readImage(images[0], 'image');
  if (image.error) return failure('invalid_request', 400, image.error);
  if (!image.mimeType.startsWith('image/')) return failure('scene_ir_v3_image_required', 400, 'Render a single PDF page to an image before v3 extraction.');
  let bytes;
  try { bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0)); }
  catch { return failure('invalid_request', 400, 'Image base64 encoding is invalid.'); }
  const selected = provider(env);
  if (selected.error) return selected.error;
  let packet;
  try { packet = await frozenPacket(); }
  catch { return failure('scene_ir_v3_contract_unavailable', 503, 'Frozen schema/runtime hashes do not match.'); }
  // v1 deliberately fails open; an experimental paid route does not inherit it.
  if (!env.AI_QUOTA) return failure('scene_ir_v3_quota_unavailable', 503, 'A working quota service is required for v3.');
  const quota = await takeQuota(request, env, cost);
  if (quota.scope === 'error' || quota.scope === 'none' || typeof quota.ok !== 'boolean') return failure('scene_ir_v3_quota_unavailable', 503, 'Quota eligibility could not be established.');
  if (!quota.ok) return failure('ai_quota_exceeded', 429, 'The daily extraction quota is exhausted.');
  const record = {
    id: JOB_PREFIX + crypto.randomUUID(), state: 'starting', extractionContract: EXTRACTION_CONTRACT,
    contract: packet.contract, subjectHash: allowed.subjectHash,
    provider: 'openai', adapter: V3_PROVIDER_ADAPTER, structuredOutput: false,
    model: selected.config.model, imageSha256: await sha256(bytes), imageMimeType: image.mimeType,
    createdAt: new Date().toISOString(), providerJobId: null,
  };
  try { await writeRecord(env, record); }
  catch { return failure('scene_ir_v3_storage_unavailable', 503, 'The source job could not be persisted. No provider call was made.'); }
  const started = await startJob({
    config: selected.config, system: packet.promptText,
    docs: [packet.schemaText, packet.capabilitiesText], text: '', images: [image],
    maxOutputTokens: 32768, fetchImpl: deps.fetchImpl,
  });
  if (!started.ok) {
    record.state = 'failed'; record.upstreamError = { status: started.status, message: started.message };
    try { await writeRecord(env, record); } catch { /* Retain the pre-call record; never retry the model. */ }
    return json({ ...base(record), error: 'ai_upstream_error', status: started.status, message: started.message }, 502);
  }
  record.providerJobId = started.id;
  record.state = 'pending';
  try {
    if (started.done) await saveProviderResponse(env, record, started.data);
    else await writeRecord(env, record);
  } catch {
    return json({ ...base(record), error: 'scene_ir_v3_storage_unavailable', rawResponse: record.rawResponse, rawRetained: false, message: 'The provider was called, but its result could not be persisted. Do not automatically retry extraction.' }, 503);
  }
  return json({ ...base(record), jobs: [record.id] });
}

function finishedResponse(record) {
  const shared = { ...base(record), rawResponse: record.rawResponse, usage: record.usage, valid: false, canApply: false, sceneIR: null };
  if (record.providerIdMismatch) return json({ ...shared, error: 'ai_upstream_error', diagnostics: [{ code: 'provider_job_mismatch', severity: 'error', path: 'scene', message: 'Provider returned a different job ID; raw output retained without acceptance.' }] }, 502);
  if (record.providerStatus !== 'completed') {
    return json({ ...shared, error: 'ai_upstream_error', diagnostics: [{ code: 'provider_incomplete', severity: 'error', path: 'scene', message: 'Provider did not complete extraction; retained raw output is not a successful scene.' }] }, 502);
  }
  if (ENCODER.encode(record.rawResponse).byteLength > MAX_RAW_BYTES) return json({ ...shared, error: 'scene_ir_v3_invalid', diagnostics: [{ code: 'raw_size_limit', severity: 'error', path: 'scene', message: 'Raw output exceeds the validation bound.' }] }, 422);
  let source;
  try { source = JSON.parse(record.rawResponse); }
  catch { return json({ ...shared, error: 'scene_ir_v3_invalid', diagnostics: [{ code: 'invalid_json', severity: 'error', path: 'scene', message: 'Raw output is not a single JSON value. No repair or fallback was attempted.' }] }, 422); }
  let compiled;
  try { compiled = SceneIRV3.compile(source); }
  catch { return json({ ...shared, error: 'scene_ir_v3_invalid', diagnostics: [{ code: 'validation_failed', severity: 'error', path: 'scene', message: 'Source validation failed. Raw output remains available.' }] }, 422); }
  // valid describes retained source consistency. canApply remains false even for
  // valid sources; retained_preview_only is a materialization blocker, not parse failure.
  return json({
    ...shared, valid: compiled.valid, sceneIR: compiled.sourceScene,
    reconstructionStatus: compiled.reconstructionStatus, diagnostics: compiled.diagnostics,
    sourcePreview: compiled.sourcePreview,
    ...(compiled.valid ? {} : { error: 'scene_ir_v3_invalid' }),
  }, compiled.valid ? 200 : 422);
}

export async function pollSceneIRV3({ payload, env, deps, request }) {
  const allowed = await access(request, env, deps);
  if (allowed.error) return allowed.error;
  if (!Array.isArray(payload.jobs) || payload.jobs.length !== 1 || !/^sir3_[0-9a-f-]{36}$/.test(payload.jobs[0])) {
    return failure('scene_ir_v3_job_mismatch', 400, 'Exactly one v3 source job is required.');
  }
  let record, packet;
  try { record = await readRecord(env, payload.jobs[0]); packet = await frozenPacket(); }
  catch { return failure('scene_ir_v3_storage_unavailable', 503, 'The source job or packet could not be read.'); }
  if (!record || record.subjectHash !== allowed.subjectHash) return failure('scene_ir_v3_job_not_found', 404, 'The source job is unavailable from this connection.');
  if (record.id !== payload.jobs[0] || record.extractionContract !== EXTRACTION_CONTRACT || JSON.stringify(record.contract) !== JSON.stringify(packet.contract) || record.adapter !== V3_PROVIDER_ADAPTER || record.provider !== 'openai') {
    return failure('scene_ir_v3_job_mismatch', 409, 'The persisted source contract does not match this route.');
  }
  if (record.state === 'completed') return finishedResponse(record);
  if (record.state === 'failed') return json({ ...base(record), error: 'ai_upstream_error', ...record.upstreamError }, 502);
  if (!record.providerJobId) return failure('scene_ir_v3_job_incomplete', 409, 'The source job never received a provider ID. No automatic retry is permitted.');
  const selected = provider(env);
  if (selected.error) return selected.error;
  const got = await fetchJob({ config: { ...selected.config, model: record.model }, id: record.providerJobId, fetchImpl: deps.fetchImpl });
  if (!got.ok) return json({ ...base(record), error: 'ai_upstream_error', status: got.status, message: got.message }, 502);
  if (!got.done) return json({ ...base(record), pending: true, done: 0, total: 1 });
  try { await saveProviderResponse(env, record, got.data); }
  catch { return json({ ...base(record), error: 'scene_ir_v3_storage_unavailable', rawResponse: record.rawResponse, rawRetained: false, message: 'Raw provider output could not be persisted; extraction was not retried.' }, 503); }
  return finishedResponse(record);
}
