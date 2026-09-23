# Custom Box Makers · Box Studio

Complete TypeScript source for the editable packaging studio: React frontend, Worker backend, D1 database schema/migration, R2 artwork storage, and API integration tests.

## What is included

- Straight tuck, roll-end mailer, counter display, and book-style rigid boxes.
- Animated Closed → Open → Flat dieline controls, including flaps and separate rigid tray/cover nets.
- Editable inside/outside panels, dimensions, material, finish, text, images, shapes, colors, layer order, rotation, and opacity.
- Three.js 3D preview, with a Canvas renderer for devices without WebGL.
- SVG dieline, PNG mockup, and self-contained editable JSON downloads.
- Account-based online project create/list/read/update/delete and private image uploads.
- Optimistic revisions to prevent stale saves from overwriting newer changes.
- Temporary sign-in draft recovery; online records are stored on the server.

## Stack and source map

The frontend and backend are separate modules in one full-stack application, deployed on the same origin. The backend is a Cloudflare-compatible Worker, not a separate Express process.

| Location | Responsibility |
| --- | --- |
| `app/page.tsx` | Main editable design workspace |
| `app/cloud-projects.tsx` | Online project shelf and sign-in UI |
| `app/box-geometry.ts` | Shared panel geometry and crease transforms |
| `app/box-preview.tsx` | Three.js preview |
| `app/software-preview.tsx` | Canvas fallback |
| `app/box-texture.ts` | Panel artwork textures |
| `app/studio-model.ts` | Editable project types and local file format |
| `app/globals.css` | Custom Box Makers theme and responsive layout |
| `lib/project-client.ts` | Frontend API client and embedded-image conversion |
| `app/api/` | Backend REST routes |
| `lib/server/api.ts` | Identity, errors, size limits, and storage helpers |
| `lib/server/project-schema.ts` | Strict server validation |
| `app/chatgpt-auth.ts` | Hosted identity adapter |
| `db/schema.ts` | Drizzle database schema |
| `drizzle/` | Generated SQL migration and schema snapshots |
| `tests/api-integration.mjs` | Isolated Worker/D1/R2 integration checks |
| `.openai/hosting.json` | Logical database and bucket bindings |

## Local setup

Requirements: Node.js 22.13 or newer and pnpm 11.25.0. No production credentials are needed for local development.

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm build
```

A clean checkout uses the portable execution profile automatically. The build creates `dist/server/wrangler.json`, including local D1 and R2 bindings.

Apply the initial database migration **once** to a new local database:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dizzy_risque.sql
```

Then run the frontend and API together:

```sh
pnpm dev
```

Open the loopback URL printed by the server (normally `http://localhost:5173`). Open **My projects → Sign in with ChatGPT**. Portable loopback development simulates a local test account; it does not use your real ChatGPT account. Mock authentication is absent from production builds. Local D1 and R2 data live in ignored `.wrangler/state`.

No `.env` file is required. Keep secrets out of frontend code and source control. Sites manages production database/bucket bindings and authentication.

## Validation

```sh
pnpm typecheck
pnpm build
pnpm test:api
```

The integration suite boots the actual built Worker using Miniflare with temporary D1 and R2 storage. It applies the checked-in migrations, then verifies save/reopen, asset round trips, anonymous rejection, per-account isolation, validation, stale-save rejection, and delete behavior. Test identity headers are passed directly to the isolated Worker; they are never enabled as an app endpoint or production bypass. The suite does not contact a hosted service.

`pnpm start` runs the built Worker locally. It does not simulate sign-in; use `pnpm dev` for the interactive local test account.

## Using the editor

1. Choose a box style and set dimensions, stock, and finish.
2. Select an editable panel, then add text, images, or shapes. Choose Inside for interior printing.
3. Drag artwork on the dieline and adjust its properties.
4. Use Closed, Open, Flat dieline, or the fold slider. Expand dieline shows the complete 2D sheet.
5. **Save project** downloads a JSON file containing all artwork. **Open** imports it.
6. **My projects** saves designs privately online, reopens them, saves copies, and deletes saved records. Loading another design remains undoable in the editor.
7. **Export** downloads editable JSON, SVG artwork, or a PNG mockup.

The display tray remains open-front; Closed folds its header down. The rigid style is a book-style cover with a separate tray, not a telescopic lift-off lid.

## Backend API

All responses containing user data use `Cache-Control: private, no-store`. API routes are same-origin and do not enable cross-origin access. Mutations require `X-BoxStudio-Request: 1`; JSON requests require `Content-Type: application/json`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/session` | Display name or anonymous state, sign-in/out paths |
| GET | `/api/projects` | Current user's projects, newest first |
| POST | `/api/projects` | Create from `{project}`; returns `{id,revision,updatedAt}` |
| GET | `/api/projects/:id` | Return document and current revision |
| PUT | `/api/projects/:id` | Update from `{project,revision}`; returns incremented revision |
| DELETE | `/api/projects/:id` | Delete an owned project record |
| POST | `/api/assets` | Raw PNG/JPEG/WebP bytes; returns `{id,url}` |
| GET | `/api/assets/:id` | Stream artwork after ownership check |

For uploads, send the image MIME type as `Content-Type`; optional `X-File-Name` is URI-encoded. The frontend embeds images for editing/offline backups, uploads them before an online save, and replaces the embedded sources with owned `/api/assets/:id` references. Opening a saved project retrieves the private images and embeds them again. Identical artwork is deduplicated per account.

Errors are JSON `{error: string}`. Statuses: `400` invalid data, `401` sign-in required, `403` disallowed mutation, `404` missing/non-owned record, `409` revision conflict or project limit, `413` size/storage limit, `415` unsupported content type, and `503` temporary storage failure. Errors preserve the current editor document.

A project has schema version 1, one of `tuck|mailer|display|rigid`, dimensions and units, material/finish, a color map for both sides of each panel, and an array of editable layers. See the shared TypeScript types and server Zod schema for exact fields and accepted values. Unknown fields and external image references are rejected by the server.

Limits: 200 projects per account, 200 layers per project, 3 MB online project JSON, 10 MB per uploaded image, and a 500 MB per-account artwork allowance. The artwork allowance is checked at upload time and is not a transactional billing quota. Local image imports resize to a maximum edge of 2048 pixels before editing.

## Authentication and production deployment

The hosted build uses the Sites platform's Sign in with ChatGPT flow. The platform authenticates visitors and injects trusted identity headers before forwarding requests to the Worker. The server derives ownership from that authenticated user ID, never from a client-provided document field. Anonymous visitors can use the editor; online storage requires sign-in.

Deploy this project through Sites with logical D1 binding `DB` and R2 binding `BUCKET`. Sites provisions the resources and applies the checked-in generated migration before publishing. Existing Site changes must keep that Site's project identity. The downloadable source ZIP intentionally omits the live Site's project ID so it cannot accidentally update this deployment.

### Connecting to customboxmakers.com

This delivery is a standalone studio; it has not modified your WordPress installation. A developer can link to the hosted studio from your website immediately. For hosting under your own domain or infrastructure, provision the Worker, D1 and R2 resources and integrate the website's verified authentication with `app/chatgpt-auth.ts` (or use a trusted authentication gateway).

**Do not expose the current header-based identity adapter directly on an untrusted origin outside Sites.** A gateway must remove incoming identity headers and inject verified identity, or the adapter must validate a real server-side session. The `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback` paths are platform-owned, not standalone OAuth implementations. A plain PHP/shared-hosting upload does not run this Worker application.

## Database changes and operations

Edit `db/schema.ts`, then run `pnpm db:generate`. Inspect and commit the generated SQL and metadata. Never edit an already-applied migration. Apply each new migration once locally, in journal order; production applies them through Sites. Queries use prepared statements with user ownership predicates.

Deleting a project deletes its database record. Artwork is retained privately because it may be shared by other saved designs. This release does not include an artwork garbage collector, account deletion workflow, order checkout, admin dashboard, or print-production pipeline. Configure backups, operational monitoring, and an artwork retention policy before a large customer rollout. Images are checked for MIME type, size, and signature; this is not a malware-scanning service.

## Design and production scope

The orange/white/charcoal interface follows Custom Box Makers' brand direction. Geometry is parametric and adapted from CBM references. SVG exports are RGB design proofs; printer approval is needed for exact cutting dies, bleed, glue areas, board thickness, material tolerances, and CMYK conversion. Software 3D uses simplified lighting. The original Packola editor is a functional reference, not a code dependency.

Reference templates:

- https://www.customboxmakers.com/free-dieline-templates/
- https://www.customboxmakers.com/wp-content/uploads/2025/11/Mailer-Box.pdf
- https://www.customboxmakers.com/wp-content/uploads/2025/11/Display-Box.pdf
- https://www.customboxmakers.com/wp-content/uploads/2025/11/Book-Style-Box.pdf
