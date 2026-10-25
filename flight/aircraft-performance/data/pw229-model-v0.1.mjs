// Generated from ../../../data/validation/aircraft-performance/bms4381-mk84-mil-confirmed-20261012/pw229-model-v0.1.json. Do not edit by hand; the test pins it to that JSON.
// Work / research model / Not Official. The selected PW-229 MIL model (aircraft-performance SPEC §14) as an ES module,
// so a browser page or Worker can load it without a JSON import. BOX OUT v0.2 uses it at runtime as an unofficial
// adoption (SPEC §15).
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
export const PW229_MODEL_V0_1 = deepFreeze({
  "schemaVersion": 1,
  "modelId": "pw229-manual-bms-performance-v0.1",
  "status": "WORK_RESEARCH_NOT_OFFICIAL",
  "engineModel": "F100-PW-229",
  "powerSetting": "MIL",
  "configurationId": "mk84x2-tank370x2-aa4-sniper-ecm-mil-premise",
  "nonFuelMassLb": 28298,
  "thrustScale": 1,
  "thrustAlignment": "VELOCITY_ALIGNED_REFERENCE",
  "drag": {
    "areaM2": [
      0.44908697660087954,
      0.8150940595921717
    ],
    "altitudeKnotsFt": [],
    "altitudeAreaM2": [],
    "inducedPerM2": 0.006370115515102665
  },
  "domain": {
    "basis": "COMPLETE_FIRST_70_PERCENT_FORCE_BLOCK_STATES_ONLY",
    "ranges": {
      "altitudeMslFt": [
        392.5524934383202,
        22005.18372703412
      ],
      "casKt": [
        279.91360691144706,
        480.1295896328293
      ],
      "fuelKg": [
        4397,
        4928
      ],
      "loadFactorG": [
        0,
        7.4
      ],
      "aoaDeg": [
        0.1,
        17.9
      ]
    },
    "altitudeCasHull": [
      [
        0.03925524934383202,
        3.946004319654427
      ],
      [
        0.09608267716535433,
        3.712742980561555
      ],
      [
        2.1998654855643043,
        2.7991360691144704
      ],
      [
        2.199963910761155,
        2.7991360691144704
      ],
      [
        2.20012467191601,
        2.818574514038877
      ],
      [
        2.200249343832021,
        2.8380129589632825
      ],
      [
        2.200334645669291,
        2.857451403887689
      ],
      [
        2.2003937007874015,
        2.8768898488120946
      ],
      [
        2.2004330708661417,
        2.896328293736501
      ],
      [
        2.200465879265092,
        2.9157667386609067
      ],
      [
        2.200485564304462,
        2.935205183585313
      ],
      [
        2.200511811023622,
        2.974082073434125
      ],
      [
        2.200518372703412,
        3.0518358531317493
      ],
      [
        2.200518372703412,
        3.071274298056155
      ],
      [
        2.2003313648293963,
        3.7321814254859604
      ],
      [
        2.2001870078740158,
        4.08207343412527
      ],
      [
        2.199465223097113,
        4.101511879049676
      ],
      [
        2.1944816272965877,
        4.120950323974082
      ],
      [
        2.161049868766404,
        4.1792656587473
      ],
      [
        2.148733595800525,
        4.198704103671706
      ],
      [
        1.5276902887139105,
        4.781857451403887
      ],
      [
        1.4974081364829397,
        4.801295896328293
      ],
      [
        1.4366535433070866,
        4.801295896328293
      ],
      [
        0.5149081364829396,
        4.723542116630669
      ],
      [
        0.04012467191601049,
        4.295896328293736
      ],
      [
        0.03932086614173228,
        4.004319654427645
      ],
      [
        0.03927493438320209,
        3.9848812095032393
      ],
      [
        0.03925524934383202,
        3.965442764578833
      ]
    ]
  },
  "provenance": {
    "thrust": "HFFM source-estimated; actual engine is a scenario",
    "atmosphere": "ISA-equivalent",
    "mass": "Prior loaded 28298-lb non-fuel premise plus recorded fuel",
    "lift": "Signed telemetry G squared, not recovered aerodynamic lift",
    "modernPods": "Absorbed in fitted effective drag area; no DI assigned"
  },
  "reviewChoice": "SIMPLE_GLOBAL_BASELINE_AFTER_EXPLORATORY_COMPARISON_NOT_BLIND"
});
