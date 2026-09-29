'use strict';
importScripts('vendor/xlsx-0.20.3.full.min.js','spreadsheet-io.js');
onmessage=({data})=>{
  try{
    const result=data.action==='write'?SpreadsheetIO.write(data.dataset):data.action==='xlsx'?SpreadsheetIO.readXlsx(data.bytes):SpreadsheetIO.readCsv(data.text);
    postMessage({result},result instanceof ArrayBuffer?[result]:[]);
  }catch(error){postMessage({error:error.message||'Fișierul nu a putut fi citit.'});}
};
