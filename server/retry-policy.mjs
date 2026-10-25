// RFC 9110 Retry-After: delay-seconds or an HTTP-date. Never persist raw headers.
function httpDate(value,now){
 const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];let parts,weekday,day,month,year,hour,minute,second;
 if((parts=value.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/))){[,weekday,day,month,year,hour,minute,second]=parts;}
 else if((parts=value.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/))){[,weekday,day,month,year,hour,minute,second]=parts;weekday=weekday.slice(0,3);const current=new Date(now).getUTCFullYear();year=Math.floor(current/100)*100+Number(year);if(year>current+50)year-=100;}
 else if((parts=value.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) ( [1-9]|[12]\d|3[01]) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/))){[,weekday,month,day,hour,minute,second,year]=parts;}
 else return NaN;
 const m=months.indexOf(month),d=new Date(0);d.setUTCFullYear(Number(year),m,Number(day));d.setUTCHours(Number(hour),Number(minute),Number(second),0);
 if(m<0||d.getUTCFullYear()!==Number(year)||d.getUTCMonth()!==m||d.getUTCDate()!==Number(day)||d.getUTCHours()!==Number(hour)||d.getUTCMinutes()!==Number(minute)||d.getUTCSeconds()!==Number(second)||days[d.getUTCDay()]!==weekday)return NaN;return d.getTime();
}
export function retryAfter(headers,now=Date.now()){
 const value=headers.get('retry-after');if(value===null)return {status:'absent',notBefore:null};
 let time;if(/^\d+$/.test(value)){const seconds=Number(value);if(Number.isSafeInteger(seconds))time=now+seconds*1000;}
 else time=httpDate(value,now);
 if(!Number.isFinite(time)||time>253402300799999)return {status:'unsupported',notBefore:null};
 return {status:'parsed',notBefore:new Date(Math.max(now,time)).toISOString()};
}
export const RECOVERY_POLICY={maxChecks:12,durationMs:15*60*1000,baseDelayMs:15000,maxDelayMs:120000,jitter:0.25};
export function recoveryDelay(checks,random=Math.random,policy=RECOVERY_POLICY){const base=Math.min(policy.maxDelayMs,policy.baseDelayMs*2**Math.max(0,Math.min(30,checks-1)));return Math.round(base*(1+Math.max(0,Math.min(1,random()))*policy.jitter));}
