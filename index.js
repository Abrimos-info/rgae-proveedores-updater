#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Client } = require('@opensearch-project/opensearch');
const { slugify } = require('transliteration');

const {
  OPENSEARCH_URL,
  DATA_DIR,
  OPENSEARCH_INDEX,
  OPENSEARCH_ID_FIELD,
} = process.env;

for (const [key, value] of Object.entries({
  OPENSEARCH_URL,
  DATA_DIR,
  OPENSEARCH_INDEX,
  OPENSEARCH_ID_FIELD,
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const client = new Client({ node: OPENSEARCH_URL });

const FILES = {
  representantes_legales: 'representantes_legales.xlsx',
  comercios: 'comercios.xlsx',
  especialidades: 'especialidades.xlsx',
  registro_de_proveedores: 'registro_de_proveedores.xlsx',
};

function readSheet(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });

  let modifiedDate = null;
  const modProp = wb.Props && wb.Props.ModifiedDate;
  if (modProp) {
    const d = new Date(modProp);
    if (!isNaN(d.getTime())) modifiedDate = d;
  }
  if (!modifiedDate) {
    modifiedDate = fs.statSync(filePath).mtime;
  }

  return { rows, modifiedDate };
}

function normStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function parseMMDDYYYY(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    if (value.getUTCFullYear() < 1900) return null;
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    ).toISOString();
  }
  const s = String(value).trim();
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt.toISOString();
}

async function main() {
  const filePaths = Object.fromEntries(
    Object.entries(FILES).map(([key, name]) => [key, path.join(DATA_DIR, name)])
  );

  for (const [key, p] of Object.entries(filePaths)) {
    if (!fs.existsSync(p)) {
      console.error(`Missing file ${FILES[key]} in ${DATA_DIR}`);
      process.exit(1);
    }
  }

  const master = {};
  const otherRepresentations = {};
  let lastUpdatedDate = null;

  const bumpDate = (d) => {
    if (d && (!lastUpdatedDate || d > lastUpdatedDate)) lastUpdatedDate = d;
  };

  const ensure = (id) => {
    if (!master[id]) master[id] = {};
    return master[id];
  };

  // representantes_legales: [null, supplierId, repId, repName, ...]
  {
    const { rows, modifiedDate } = readSheet(filePaths.representantes_legales);
    bumpDate(modifiedDate);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const supplierId = normStr(row[1]);
      const repId = normStr(row[2]);
      const repName = normStr(row[3]);
      if (!supplierId || !repId) continue;

      const s = ensure(supplierId);
      s.representantes_legales = s.representantes_legales || [];
      s.representantes_legales.push({ identifier: repId, name: repName });

      if (!otherRepresentations[repId]) otherRepresentations[repId] = { companies: [] };
      if (!otherRepresentations[repId].companies.includes(supplierId)) {
        otherRepresentations[repId].companies.push(supplierId);
      }
    }
  }

  // comercios: [null, supplierId, commercialName, ...]
  {
    const { rows, modifiedDate } = readSheet(filePaths.comercios);
    bumpDate(modifiedDate);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const supplierId = normStr(row[1]);
      const commercialName = normStr(row[2]);
      if (!supplierId || !commercialName) continue;

      const s = ensure(supplierId);
      s.comercios = s.comercios || [];
      if (!s.comercios.includes(commercialName)) s.comercios.push(commercialName);
    }
  }

  // especialidades: [null, supplierId, activityCode, activityName, ...]
  {
    const { rows, modifiedDate } = readSheet(filePaths.especialidades);
    bumpDate(modifiedDate);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const supplierId = normStr(row[1]);
      const activityName = normStr(row[3]);
      if (!supplierId || !activityName) continue;

      const s = ensure(supplierId);
      s.especialidades = s.especialidades || [];
      if (!s.especialidades.includes(activityName)) s.especialidades.push(activityName);
    }
  }

  // registro_de_proveedores: [null, supplierId, name, classification, status, inscription, lastPrequal, prequalExp]
  {
    const { rows, modifiedDate } = readSheet(filePaths.registro_de_proveedores);
    bumpDate(modifiedDate);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const supplierId = normStr(row[1]);
      if (!supplierId) continue;

      const s = ensure(supplierId);
      s.registro_de_proveedores = {
        name: normStr(row[2]),
        classification: normStr(row[3]),
        status: normStr(row[4]),
        inscription_date: row[5],
        last_prequalification_date: row[6],
        prequalification_expiration_date: row[7],
      };
    }
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const updatedDateIso = lastUpdatedDate ? lastUpdatedDate.toISOString() : null;

  for (const supplierId of Object.keys(master)) {
    try {
      const data = master[supplierId];

      const resp = await client.search({
        index: OPENSEARCH_INDEX,
        body: {
          query: { term: { [OPENSEARCH_ID_FIELD]: supplierId } },
          size: 10,
        },
      });

      const hits = (resp.body && resp.body.hits && resp.body.hits.hits) || [];
      if (hits.length === 0) continue;

      let hit;
      if (hits.length === 1) {
        hit = hits[0];
      } else {
        const regName = data.registro_de_proveedores && data.registro_de_proveedores.name;
        if (!regName) continue;
        hit = hits.find((h) => h._source && h._source.name === regName);
        if (!hit) continue;
      }

      const doc = hit._source || {};

      if (data.representantes_legales) {
        if (!Array.isArray(doc.representatives)) doc.representatives = [];
        const fileRepIds = new Set(data.representantes_legales.map((r) => r.identifier));

        for (const fileRep of data.representantes_legales) {
          const existing = doc.representatives.find(
            (x) => x && x.identifier === fileRep.identifier
          );
          if (existing) {
            existing.representation_date = null;
          } else {
            const hasOthers =
              (otherRepresentations[fileRep.identifier] &&
                otherRepresentations[fileRep.identifier].companies.length > 1) ||
              false;
            doc.representatives.push({
              id: slugify(`${fileRep.name || ''} GT`),
              identifier: fileRep.identifier,
              name: fileRep.name,
              representation_date: null,
              has_other_representations: hasOthers,
            });
          }
        }

        for (const rep of doc.representatives) {
          if (!rep || !rep.identifier) continue;
          if (fileRepIds.has(rep.identifier)) continue;
          const rd = rep.representation_date ? new Date(rep.representation_date) : null;
          const beforeToday = rd && !isNaN(rd.getTime()) && rd < today;
          if (!beforeToday) rep.representation_date = null;
          rep.expired = true;
        }
      }

      if (data.comercios) {
        if (!Array.isArray(doc.other_names)) doc.other_names = [];
        for (const name of data.comercios) {
          if (!doc.other_names.includes(name)) doc.other_names.push(name);
        }
      }

      if (data.especialidades) {
        doc.economic_activities = [...data.especialidades];
      }

      if (data.registro_de_proveedores) {
        const r = data.registro_de_proveedores;
        if (r.classification !== null) doc.classification = r.classification;
        if (r.status !== null) doc.status = r.status.toUpperCase();

        const ins = parseMMDDYYYY(r.inscription_date);
        if (ins) doc.rgae_inscription_date = ins;

        const lpd = parseMMDDYYYY(r.last_prequalification_date);
        if (lpd) doc.rgae_prequalification_date = lpd;

        const exp = parseMMDDYYYY(r.prequalification_expiration_date);
        if (exp) doc.rgae_prequalification_expiration_date = exp;
      }

      doc.updated_date = updatedDateIso;
      doc.source = 'rgae_proveedores';

      process.stdout.write(JSON.stringify(doc) + '\n');
    } catch (err) {
      console.error(`Error processing supplier ${supplierId}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
