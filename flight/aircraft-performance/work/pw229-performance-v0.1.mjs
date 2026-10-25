import {calculateHffmThrust} from './hffm-thrust-v0.1.mjs';
import {casToTas} from '../../../common/airspeed/airspeed-v0.1.mjs';
import {standardAtmosphere} from '../../../common/atmosphere/standard-atmosphere-v0.1.mjs';

export const G=9.8066352, KT=1852/3600, LB=.45359237;
const R=287.05287, finite=x=>typeof x==='number'&&Number.isFinite(x);
export class Pw229Error extends Error {
  constructor(code,details={}) {super(code);this.code=code;this.details=details;}
}
const fail=(code,details)=>{throw new Pw229Error(code,details);};
const stateKeys=['altitudeMslFt','casKt','fuelKg','loadFactorG','aoaDeg','verticalSpeedMps'];
const controlKeys=['timeSec','altitudeMslFt','fuelKg','loadFactorG','aoaDeg'];
export function validatePw229Model(m) {
  if(!m||m.schemaVersion!==1||m.modelId!=='pw229-manual-bms-performance-v0.1'
    ||m.engineModel!=='F100-PW-229'||m.powerSetting!=='MIL'
    ||m.thrustAlignment!=='VELOCITY_ALIGNED_REFERENCE'
    ||m.configurationId!=='mk84x2-tank370x2-aa4-sniper-ecm-mil-premise'
    ||m.nonFuelMassLb!==28298||m.thrustScale!==1
    ||!Array.isArray(m.drag?.areaM2)||m.drag.areaM2.length!==2
    ||m.drag.areaM2.some(x=>!finite(x)||x<0)
    ||!Array.isArray(m.drag.altitudeKnotsFt)||!Array.isArray(m.drag.altitudeAreaM2)
    ||m.drag.altitudeKnotsFt.length!==m.drag.altitudeAreaM2.length
    ||m.drag.altitudeKnotsFt.some((x,i,a)=>!finite(x)||(i&&x<=a[i-1]))
    ||m.drag.altitudeAreaM2.some(x=>!finite(x)||x<0)
    ||!finite(m.drag.inducedPerM2)||m.drag.inducedPerM2<0
    ||!m.domain?.ranges||stateKeys.slice(0,5).some(k=>!Array.isArray(m.domain.ranges[k])
      ||m.domain.ranges[k].length!==2||m.domain.ranges[k].some(x=>!finite(x))
      ||m.domain.ranges[k][0]>m.domain.ranges[k][1])
    ||!Array.isArray(m.domain.altitudeCasHull)||m.domain.altitudeCasHull.length<3
    ||m.domain.altitudeCasHull.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>!finite(x))))
    fail('INVALID_MODEL');
}
function inHull(points,p) {
  let sign=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    const c=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    if(Math.abs(c)<1e-9)continue;
    const s=Math.sign(c);if(sign&&s!==sign)return false;sign=s;
  }
  return true;
}
export function pw229DomainIssues(m,s) {
  const issues=Object.entries(m.domain.ranges).filter(([k,[a,b]])=>s[k]<a-1e-8||s[k]>b+1e-8).map(([k])=>k);
  if(!inHull(m.domain.altitudeCasHull,[s.altitudeMslFt/10000,s.casKt/100]))issues.push('altitudeCasHull');
  return issues;
}
/** Standard-atmosphere equivalent state. No wind is subtracted from CAS. */
export function pw229Reference(s,nonFuelMassLb) {
  if(!s||Object.keys(s).some(k=>!stateKeys.includes(k))||stateKeys.some(k=>!finite(s[k]))
      ||s.casKt<=.01||s.fuelKg<0||!finite(nonFuelMassLb)||nonFuelMassLb<=0)fail('INVALID_STATE');
  const atm=standardAtmosphere(s.altitudeMslFt),tas=casToTas(s.casKt,s.altitudeMslFt)*KT;
  const massKg=nonFuelMassLb*LB+s.fuelKg,weightN=massKg*G;
  const density=atm.pressurePa/(R*atm.temperatureK),qPa=.5*density*tas*tas;
  const mach=tas/(atm.soundSpeedKt*KT);
  return {tas,massKg,weightN,qPa,mach};
}
export function evaluatePw229Performance(model,state,{allowResearchExtrapolation=false}={}) {
  validatePw229Model(model);
  if(typeof allowResearchExtrapolation!=='boolean')fail('INVALID_OPTIONS');
  const r=pw229Reference(state,model.nonFuelMassLb),issues=pw229DomainIssues(model,state);
  if(issues.length&&!allowResearchExtrapolation)fail('OUTSIDE_RESEARCH_DOMAIN',{issues});
  const t=calculateHffmThrust({engineModel:model.engineModel,powerSetting:model.powerSetting,
    altitudeMslFt:state.altitudeMslFt,mach:r.mach});
  if(!t.validation.valid)fail('THRUST_SOURCE_UNAVAILABLE',{errors:t.validation.errors});
  const thrustN=t.thrustN*model.thrustScale;
  const weights=altitudeAreaWeights(model.drag.altitudeKnotsFt,state.altitudeMslFt);
  const dragAreaM2=model.drag.areaM2[0]+model.drag.areaM2[1]*r.mach*r.mach
    +weights.reduce((sum,x,i)=>sum+x*model.drag.altitudeAreaM2[i],0);
  const parasiticDragN=r.qPa*dragAreaM2;
  // Signed telemetry G is preserved; G squared is an explicit empirical symmetry.
  const inducedDragN=model.drag.inducedPerM2*(state.loadFactorG*r.weightN)**2/r.qPa;
  const dragN=parasiticDragN+inducedDragN,netForceN=thrustN-dragN;
  const specificExcessPowerMps=netForceN*r.tas/r.weightN;
  const tasRateMps2=netForceN/r.massKg-G*state.verticalSpeedMps/r.tas;
  const dvdc=(casToTas(state.casKt+.01,state.altitudeMslFt)-casToTas(state.casKt-.01,state.altitudeMslFt))*KT/.02;
  const dvdh=(casToTas(state.casKt,state.altitudeMslFt+1)-casToTas(state.casKt,state.altitudeMslFt-1))*KT/2;
  const casRateKtSec=(tasRateMps2-dvdh*state.verticalSpeedMps/.3048)/dvdc;
  if(![dragN,netForceN,casRateKtSec,specificExcessPowerMps].every(finite))fail('NONFINITE_RESULT');
  return {...r,thrustN,dragAreaM2,parasiticDragN,inducedDragN,dragN,netForceN,
    specificExcessPowerMps,tasRateMps2,casRateKtSec,loadFactorG:state.loadFactorG,
    outsideDomain:issues.length>0,domainIssues:issues,bmsFlightValidated:false,
    status:issues.length?'FLAGGED_RESEARCH_EXTRAPOLATION':'BOUNDED_RESEARCH_MODEL',
    warnings:['REFERENCE_ATMOSPHERE','ENGINE_AND_MASS_PREMISE','G_IS_TELEMETRY_PROXY',
      'THRUST_DRAG_NOT_INDEPENDENTLY_IDENTIFIED']};
}
/** Coefficient endpoint weights only; input states are never clamped. */
export function altitudeAreaWeights(knots,h) {
 if(!knots.length)return [];
 const w=knots.map(()=>0);
 if(h<=knots[0]){w[0]=1;return w;}
 if(h>=knots.at(-1)){w[w.length-1]=1;return w;}
 let hi=1;while(knots[hi]<h)hi++;
 w[hi]=(h-knots[hi-1])/(knots[hi]-knots[hi-1]);w[hi-1]=1-w[hi];return w;
}
/** Conditional-path speed prediction. Only the first observed CAS is admitted. */
export function predictPw229Speed(model,initialCasKt,controls,
  {maximumStepSec=.05,allowResearchExtrapolation=false}={}) {
  validatePw229Model(model);
  if(!finite(initialCasKt)||initialCasKt<=.01||!finite(maximumStepSec)||maximumStepSec<=0
    ||maximumStepSec>.25||typeof allowResearchExtrapolation!=='boolean'||!Array.isArray(controls)
    ||controls.length<2||controls.length>50000)fail('INVALID_PREDICTION');
  controls.forEach((r,i)=>{
    if(!r||Object.keys(r).some(k=>!controlKeys.includes(k))||controlKeys.some(k=>!finite(r[k]))
      ||(i&&r.timeSec<=controls[i-1].timeSec))fail('INVALID_CONTROLS',{index:i});
  });
  const span=controls.at(-1).timeSec-controls[0].timeSec;
  if(span>600||Math.ceil(span/maximumStepSec)>1000000)fail('PREDICTION_LIMIT');
  let speed=initialCasKt;const out=[];
  for(let i=0;i<controls.length;i++) {
    const b=controls[i];
    if(i) {
      const a=controls[i-1],dt=b.timeSec-a.timeSec,n=Math.ceil(dt/maximumStepSec),step=dt/n;
      const vs=(b.altitudeMslFt-a.altitudeMslFt)*.3048/dt;
      const rate=(f,casKt)=>{
        const s=Object.fromEntries(controlKeys.slice(1).map(k=>[k,a[k]+f*(b[k]-a[k])]));
        return evaluatePw229Performance(model,{...s,casKt,verticalSpeedMps:vs},{allowResearchExtrapolation}).casRateKtSec;
      };
      for(let j=0;j<n;j++) {
        const f=j/n,df=1/n,k1=rate(f,speed),k2=rate(f+df/2,speed+step*k1/2);
        const k3=rate(f+df/2,speed+step*k2/2),k4=rate(f+df,speed+step*k3);
        speed+=step*(k1+2*k2+2*k3+k4)/6;
        if(!finite(speed)||speed<=.01)fail('INVALID_PREDICTED_SPEED',{index:i});
      }
    } else evaluatePw229Performance(model,{...Object.fromEntries(controlKeys.slice(1).map(k=>[k,b[k]])),
      casKt:speed,verticalSpeedMps:0},{allowResearchExtrapolation});
    const s={...Object.fromEntries(controlKeys.slice(1).map(k=>[k,b[k]])),casKt:speed};
    const issues=pw229DomainIssues(model,s);
    out.push({...b,predictedCasKt:speed,outsideDomain:issues.length>0});
  }
  return out;
}

