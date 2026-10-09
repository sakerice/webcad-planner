# Original mansion window dressings: five constructions

Local review candidate. Root visual acceptance and independent QA are required. The application remains stopped; no accepted asset or remote tree is changed.

The bounded bill contains five genuinely different support/cloth constructions: a short paired ring-and-rod curtain, a single full-height traverse-rail drape, a Roman batten shade, a timber slatted Venetian blind, and a narrow fabric roller screen. There are zero separately counted width variants, pose variants or accessories. Both QA aperture fixtures are excluded from the product count. The existing2150mm paired curtain is reused unchanged in one example and is not counted again.

## Installation and fit

Native authoring uses metres, +Z up and -Y front; export is +Y up and +Z front. Every asset has a measured bottom-centre origin. defaultElevation is the actual lowest fabric/hem/hardware point in its illustrated floor installation. The nominal short-curtain cloth baseline is650mm; its small sewn/scalloped hem extends slightly lower. The French drape cloth baseline is80mm, with its measured sewn hem about75mm above the floor.

The accepted raised-sill wall aperture is920mm wide, from800 to2600mm above the floor. Its frame-clear opening is760mm wide, from880 to2520mm. The accepted French wall aperture is1040mm wide, from0 to2750mm; its frame-clear opening is920mm wide, from90 to2680mm. The French drape intentionally leaves a floor gap and covers all of the clear glazing.

The short curtain's outer rod/finial span is1220mm and continuous fabric span1144mm. The traverse rail is1240mm and its fabric spans1210mm. Roman and Venetian outer support spans are1000mm, with970mm cloth and977mm slats respectively. Narrow roller overall width is700mm, with662mm cloth, for an excluded640mm-wide QA aperture. That fixture has a540mm frame-clear width. The existing2150mm curtain is shown over a separate excluded1900mm aperture fixture.

Fit comparisons use the wall aperture, not the full1200mm wall bay and not the smaller frame-clear width. Both aperture and frame-clear comparisons are explicitly reported. This follows the project's source checks: curtains attach within300mm on the interior and span window+100–400mm; screens attach within200mm and span window+0–100mm. These are existing project placement checks, not engineering, fire, safety or legal standards. These static GLBs do not establish automatic native-window attachment semantics.

Each product contains physical wall plates/arms or cheeks and real rod/rail/roller support. The proof transforms rotate dressings180 degrees about Blender Z and translate their rear contact planes onto the accepted windows' interior plaster plane (+Y=120mm in construction coordinates). Accepted host GLBs are copied and imported byte-for-byte, with only rigid scene transforms. SHA-256 evidence is in proofs/inputs/accepted-input-manifest.json and reports/installation-proofs.json.

## Deliverables and reproduction

- models/: five final GLBs
- sources/: five canonical blends and numeric validations
- authoring_sources/: five editable native-part blends
- previews/: transparent512×512 thumbnail and top images
- evidence/: front/rear/left/right views, installed interior/exterior views and two review sheets
- proofs/: six actual saved Blender installation scenes, including unchanged existing-curtain reuse
- descriptors.json: family-local metadata
- integration-descriptors.json and integration-copy-map.json: standard pack destinations without performing integration
- rights-and-provenance.json: original geometry and reuse scope

Run blender -b -t 2 --python build.py to rebuild native models. Use -- --render-only for isolated previews. Run build_installation_proofs.py in the original review workspace, or make accepted input copies available first and adjust only the accepted source root. Then run render_exterior_proofs.py and python finalize.py. The first immutable native checkpoint predates long renders. Checkpoints and temporary logs are excluded from integration.

The curtain-specific triangle ceiling is12000 to retain closed folds, sewn hems and physical rings/hooks. Both shade and screen constructions use a6000-triangle ceiling. Counts and exported sizes are measured per product. All final GLBs expose independent finish channels, contain metric UVs, and use no image textures or external models.

## Limits

All objects are static closed/deployed display states. No native opening, cloth physics, slat actuation, automatic following, structural capacity or real installation safety is claimed. The accepted hosts remain fixed-glazing assets. Existing curtain reuse is a visual example only and does not retroactively certify its older attachment construction. The narrow and1900mm fixtures are QA geometry, not products or new certified windows.
