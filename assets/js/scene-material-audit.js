/* Exact bundled-asset material audit. Existing ModelQuality remains the renderer. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SceneMaterialAudit=factory();}(typeof self!=='undefined'?self:this,function(){'use strict';
const AUDITS = {
  "im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown": {
    "model": "assets/models/interior_model_0_26_1/glb/Cabinet/MEGA_PACK_CABINET__cabinet-354290_frame_walnut_brown.glb",
    "modelSHA256": "157022a07b741000c0b3da87fbebcd29250c6af1701716a353e482720159baf5",
    "geometrySHA256": "f41afc636f23e923ddb5cd117538c09cb3fc28154e31cb74d30fe3029e3230f2",
    "nativeDimensionsMm": {
      "w": 2000,
      "d": 414,
      "h": 600
    },
    "expectedExternalMapping": {
      "cabinet-354290_frame_walnut_brown": "body"
    },
    "expectedReferences": {},
    "expectedDefaults": {
      "body": 0.358
    },
    "materials": [
      {
        "name": "cabinet-354290_frame_walnut_brown",
        "channel": "body",
        "channelOrigin": "finishes.json",
        "parts": [
          "unnamed-mesh-0"
        ],
        "lockColor": false,
        "baseColorTexture": true,
        "baseColorFactor": [
          1,
          1,
          1,
          1
        ],
        "textureColorEffect": "source-luminance-neutralized-tint",
        "finishReference": 0.358,
        "finishReferenceOrigin": "channel-default",
        "normalTextureRetained": true,
        "occlusionTextureRetained": true
      }
    ],
    "independentMaterialChannels": [
      "body"
    ],
    "uniformPixelRGBGuaranteed": false,
    "sourceRegionSemanticsAudited": false
  },
  "original-sideboard": {
    "model": "assets/models/original/original-sideboard.glb",
    "modelSHA256": "be6a4bd2bbc6de3d678bf5a1504fa58721f6b49cd14213dde49f72c356d0f05c",
    "geometrySHA256": "6e026df280d8d767574d19eab04a91ac06377b4b9c098c232a7347b0ad1edb17",
    "nativeDimensionsMm": {
      "w": 1400,
      "d": 420,
      "h": 760
    },
    "expectedExternalMapping": {},
    "expectedReferences": {},
    "expectedDefaults": {},
    "materials": [
      {
        "name": "Recess and rubber",
        "channel": null,
        "channelOrigin": "none",
        "parts": [
          "Recessed cabinet plinth"
        ],
        "lockColor": true,
        "baseColorTexture": false,
        "baseColorFactor": [
          0.017999999225139618,
          0.023000000044703484,
          0.026000000536441803,
          1
        ],
        "textureColorEffect": "plain-color",
        "finishReference": null,
        "finishReferenceOrigin": "none",
        "normalTextureRetained": false,
        "occlusionTextureRetained": false
      },
      {
        "name": "Original oak",
        "channel": "wood",
        "channelOrigin": "GLB-extras",
        "parts": [
          "Cabinet side panel",
          "Cabinet side panel.001",
          "Solid cabinet top",
          "Cabinet base",
          "Recessed back panel",
          "Door panel",
          "Door panel.001",
          "Door panel.002",
          "Door panel.003",
          "Door panel.004",
          "Door panel.005"
        ],
        "lockColor": false,
        "baseColorTexture": true,
        "baseColorFactor": [
          0.3400000035762787,
          0.20999999344348907,
          0.10999999940395355,
          1.0
        ],
        "textureColorEffect": "native-RGB-multiplies-tint",
        "finishReference": null,
        "finishReferenceOrigin": "none",
        "normalTextureRetained": false,
        "occlusionTextureRetained": false
      },
      {
        "name": "Satin hardware",
        "channel": null,
        "channelOrigin": "none",
        "parts": [
          "Handle standoff",
          "Handle standoff.001",
          "Pull",
          "Handle standoff.002",
          "Handle standoff.003",
          "Pull.001",
          "Handle standoff.004",
          "Handle standoff.005",
          "Pull.002",
          "Handle standoff.006",
          "Handle standoff.007",
          "Pull.003",
          "Handle standoff.008",
          "Handle standoff.009",
          "Pull.004",
          "Handle standoff.010",
          "Handle standoff.011",
          "Pull.005"
        ],
        "lockColor": true,
        "baseColorTexture": false,
        "baseColorFactor": [
          0.2800000011920929,
          0.30000001192092896,
          0.3199999928474426,
          1
        ],
        "textureColorEffect": "plain-color",
        "finishReference": null,
        "finishReferenceOrigin": "none",
        "normalTextureRetained": false,
        "occlusionTextureRetained": false
      }
    ],
    "independentMaterialChannels": [
      "wood"
    ],
    "uniformPixelRGBGuaranteed": false,
    "sourceRegionSemanticsAudited": false
  },
  "fmp-Sofa01": {
    "model": "assets/models/furniture_mega/glb/Sofa01.glb",
    "modelSHA256": "4f5f86002e750a9d513dc704eeba5c3a544afff25732290fa4d2b5e8dd2f36ef",
    "geometrySHA256": "fed675c13617ee92b5040f34fe668b76ce2c7c7b5aea12afd314b0849ec35a7d",
    "nativeDimensionsMm": {
      "w": 1867,
      "d": 770,
      "h": 731
    },
    "expectedExternalMapping": {
      "mat_Sofa01": "body"
    },
    "expectedReferences": {},
    "expectedDefaults": {
      "body": 0.358
    },
    "materials": [
      {
        "name": "mat_Sofa01",
        "channel": "body",
        "channelOrigin": "finishes.json",
        "parts": [
          "unnamed-mesh-0"
        ],
        "lockColor": false,
        "baseColorTexture": true,
        "baseColorFactor": [
          1,
          1,
          1,
          1
        ],
        "textureColorEffect": "source-luminance-neutralized-tint",
        "finishReference": 0.358,
        "finishReferenceOrigin": "channel-default",
        "normalTextureRetained": true,
        "occlusionTextureRetained": false
      }
    ],
    "independentMaterialChannels": [
      "body"
    ],
    "uniformPixelRGBGuaranteed": false,
    "sourceRegionSemanticsAudited": false
  },
  "im0261-Sofa-MEGA_PACK_Sofa-BOLIA_sofa_Ivory": {
    "model": "assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb",
    "modelSHA256": "bd3e6b3a33c5bbf7c88b9a637b732d31d1e4356de8651e3bd0807d715e49271c",
    "geometrySHA256": "157f02a2b504b0bbb8e65abff80f817af65380918d942cabf46c7599da15bec2",
    "nativeDimensionsMm": {
      "w": 2693,
      "d": 2120,
      "h": 798
    },
    "expectedExternalMapping": {
      "sofa-e5ybetgdh45y.002": "fabric",
      "sofa-e5ybetgdh45y.003": "accent",
      "BOLIA-Ivory": "wood"
    },
    "expectedReferences": {
      "BOLIA-Ivory": 0.3
    },
    "expectedDefaults": {
      "accent": 0.38,
      "fabric": 0.38,
      "wood": 0.242
    },
    "materials": [
      {
        "name": "BOLIA-Ivory",
        "channel": "wood",
        "channelOrigin": "finishes.json",
        "parts": [
          "unnamed-mesh-0"
        ],
        "lockColor": false,
        "baseColorTexture": true,
        "baseColorFactor": [
          1,
          1,
          1,
          1
        ],
        "textureColorEffect": "source-luminance-neutralized-tint",
        "finishReference": 0.3,
        "finishReferenceOrigin": "material-reference",
        "normalTextureRetained": true,
        "occlusionTextureRetained": true
      },
      {
        "name": "sofa-e5ybetgdh45y.002",
        "channel": "fabric",
        "channelOrigin": "finishes.json",
        "parts": [
          "unnamed-mesh-0"
        ],
        "lockColor": false,
        "baseColorTexture": true,
        "baseColorFactor": [
          1,
          1,
          1,
          1
        ],
        "textureColorEffect": "source-luminance-neutralized-tint",
        "finishReference": 0.38,
        "finishReferenceOrigin": "channel-default",
        "normalTextureRetained": false,
        "occlusionTextureRetained": false
      },
      {
        "name": "sofa-e5ybetgdh45y.003",
        "channel": "accent",
        "channelOrigin": "finishes.json",
        "parts": [
          "unnamed-mesh-0"
        ],
        "lockColor": false,
        "baseColorTexture": true,
        "baseColorFactor": [
          1,
          1,
          1,
          1
        ],
        "textureColorEffect": "source-luminance-neutralized-tint",
        "finishReference": 0.38,
        "finishReferenceOrigin": "channel-default",
        "normalTextureRetained": false,
        "occlusionTextureRetained": false
      }
    ],
    "independentMaterialChannels": [
      "accent",
      "fabric",
      "wood"
    ],
    "uniformPixelRGBGuaranteed": false,
    "sourceRegionSemanticsAudited": false
  }
};
const clone=v=>JSON.parse(JSON.stringify(v)),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function describe(item,finishData){
 const audit=AUDITS[item.id],declared=(item.finishChannels||[]).map(c=>({key:c.key,label:c.label||c.key,default:c.default}));
 const unknown={status:'unreviewed',declaredChannels:declared,verifiedChannels:[],fixedMaterials:[],sourceRegionSemanticsAudited:false,uniformPixelRGBGuaranteed:false,reason:'Declared controls are not an asset/part audit'};
 if(!audit)return unknown;
 const data=finishData||{},map=(data.models||{})[item.model]||{},refs=(data.references||{})[item.model]||{},defaults=Object.fromEntries(Object.keys(audit.expectedDefaults).map(k=>[k,(data.defaults||{})[k]]));
 if(item.model!==audit.model||!['w','d','h'].every(k=>item[k]===audit.nativeDimensionsMm[k])||!equal(map,audit.expectedExternalMapping)||!equal(refs,audit.expectedReferences)||!equal(defaults,audit.expectedDefaults))return {...unknown,status:'audit-mismatch',reason:'Asset path/dimensions or existing finish wiring changed; re-audit required'};
 const keys=declared.map(c=>c.key),verified=audit.independentMaterialChannels.filter(k=>keys.includes(k)).map(key=>({...declared.find(c=>c.key===key),materials:clone(audit.materials.filter(m=>m.channel===key)),color:true,textureReplacement:true,roughness:true}));
 return {status:'asset-and-code-audited',asset:{path:audit.model,sha256:audit.modelSHA256,geometrySHA256:audit.geometrySHA256,geometryHashBasis:'position/index or Draco geometry buffers and static node transforms; not a shape-equivalence certificate'},defaultHeight:{valueMm:item.h,origin:'catalogue-manifest',sourceMeasured:false,widthDepthFitChangesHeight:false},declaredChannels:declared,verifiedChannels:verified,fixedMaterials:clone(audit.materials.filter(m=>!keys.includes(m.channel))),independentChannelCount:verified.length,sourceRegionSemanticsAudited:false,uniformPixelRGBGuaranteed:false,renderer:'ModelQuality.prepare/applyFinishes; existing finishColors/finishTextures/finishRoughness',limits:['Channel names describe asset material groups, not source drawing regions','Texture luminance or native RGB can alter displayed pixels','Unmapped materials retain native finishes']};
}
return {describe,audits:()=>clone(AUDITS)};
}));
