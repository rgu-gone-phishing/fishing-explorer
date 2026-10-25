import {metricField} from '../shared/catalogue.mjs';
export const CSV_TRANSFORM='spreadsheet-safe-csv-v2';
export const csvFields=source=>['date','lat','lon','geartype','vesselType','flag','vesselId',metricField(source)];
export function encodeCSV(value){let text=String(value??'');const trimmed=text.trimStart();const negativeNumber=/^-\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed);if(/^[\s\uFEFF]*[=+@]/u.test(text)||/^[\t\r\n]/.test(text)||trimmed.startsWith('-')&&!negativeNumber)text="'"+text;return `"${text.replaceAll('"','""')}"`;}
export function rowsCSV(query,rows){const fields=csvFields(query.source);return [fields.join(','),...rows.map(row=>fields.map(k=>encodeCSV(row[k])).join(','))].join('\n')+'\n';}
