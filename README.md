# rgae-proveedores-updater

Node.js script that merges supplier data from Guatemala's RGAE (Registro General de Adquisiciones del Estado) Excel exports into existing Opensearch documents from the Guatecompras supplier index for (sociedad.info)[https://sociedad.info/], emitting the updated documents as NDJSON to stdout.

## Input files

Files are obtained from (this portal)[https://datos.minfin.gob.gt/group/contratistas-y-proveedores-del-estado-rgae] and renamed according to the table below. All four files must live in the directory pointed to by `DATA_DIR`:

| File                          | Columns used (1-indexed)                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `representantes_legales.xlsx` | 2: supplier ID · 3: representative ID · 4: representative name                                       |
| `comercios.xlsx`              | 2: supplier ID · 3: commercial name                                                                  |
| `especialidades.xlsx`         | 2: supplier ID · 3: activity code · 4: activity name                                                 |
| `registro_de_proveedores.xlsx`| 2: supplier ID · 3: name · 4: classification · 5: status · 6: inscription · 7: last prequal · 8: prequal expiration |

The first column of every file is ignored. The first row is treated as a header row and skipped.

## Setup

```sh
npm install
cp .env.example .env
# edit .env with your values
```

### Environment variables

| Variable              | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `OPENSEARCH_URL`      | Opensearch connection string (scheme, host, port, credentials if needed) |
| `DATA_DIR`            | Path to the directory containing the four `.xlsx` files                  |
| `OPENSEARCH_INDEX`    | Name of the index to query                                               |
| `OPENSEARCH_ID_FIELD` | Field in the indexed document used to match the supplier ID              |

## Run

```sh
node index.js > output.ndjson
```

Each line of stdout is a complete updated document, suitable for piping into Opensearch's bulk API or for further processing. Errors and per-supplier failures are written to stderr.

## License

MIT — see [LICENSE](LICENSE).
