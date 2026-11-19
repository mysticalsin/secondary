# Data Model: v24 deploy recovery

## Binding

A binding has a name and one type.

| Type | Count | What the config stores |
|---|---|---|
| plain-text setting | 11 | The name, in the config comment. No value. |
| secret | 9 | The name, in `secrets.required`. No value. |
| service | 2 | Binding name and service name. |
| R2 bucket | 1 | Binding name, bucket name, jurisdiction `eu`. |
| Durable Object namespace | 2 | Binding name and class name. |
| assets | 1 | Binding name `ASSETS` and the asset fields in FR-006. |

The 26 names are the contract. No other binding is added.

## Graph file

A graph file has a public path, a repo path, a content type, and a sha256 of the UTF-8 body. The eight rows are `contracts/graph-entry.md`. The wrapper's header set is the nine header names in that contract. The nav snippet and the five API prefixes are fixed strings in that contract.

## Migration entry

One entry. Tag `v3`. `new_sqlite_classes` is `TenantPolicy` then `Workspace`. No other migration key is present.

## Member columns

`brain_members.pending_role` is nullable text. `brain_members.pending_at` is nullable integer. v24's stored table, as compiled into v24, has neither column in the Worker source. Main's constructor adds each column when `PRAGMA table_info` does not list it. Existing cells stay. This feature does not change that table or those rows.

## Asset directory

`deploy/assets/` contains one marker file, `UNREPRODUCED`. It is not a recovered SPA file. The live SPA bytes are not a row in this model.

## Asset manifest

An asset manifest is `MANIFEST.sha256` in that directory. Each line names one relative path and the sha256 of that file's bytes. The line shape and the directory rules are `contracts/asset-manifest.md`. The manifest is not stored in this repo. A passing check has the marker absent, one or more listed files, each hash equal to the file bytes, and no extra file. A test builds that directory with synthetic bytes and then deletes it with the temporary directory.
