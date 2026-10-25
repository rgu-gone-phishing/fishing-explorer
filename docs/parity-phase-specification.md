# Fishing Explorer: value-add parity specification

**Draft for client and engineering review · 23 October 2026**

Build a locally operated research interface that makes GFW's authorized data easier to select, inspect, extract and revisit. The defining outcome is a saved, understandable data extract whose source, resolution, coverage and processing history remain visible from the first query through the final figure.

This is phase one of a two-phase programme. Phase one improves access and presentation of existing products, including descriptive comparisons. Phase two investigates new analytical methods beyond GFW's processing. The [development plan](parity-phase-development-plan.md) sequences the work; the [evidence review](gfw-parity-evidence.md) separates observed source behavior, documentation, historical probes and design hypotheses. The [screen concepts](parity-phase-concepts.md) illustrate the proposed experience.

## 1. Decisions proposed for agreement

1. **Define a bounded parity contract.** Cover the scientific workflows below, rather than every GFW application, administrative feature or internal endpoint. Maintain an explicit list of unavailable and conditional capabilities.
2. **Put extraction alongside exploration.** A map preview is one view of a study. Area, dates, dataset version, spatial detail and temporal detail are explicit study inputs, independent of map zoom.
3. **Give VMS the first discovery milestone.** The client wants whichever territories are available. The current availability table lists selective map downloads but no public VMS API. Deliver availability discovery and permitted file import; implement a direct connector only with supported access and appropriate rights. Do not substitute AIS and call it VMS parity. [GFW availability](https://globalfishingwatch.org/global-fishing-watch-data-availability/)
4. **Archive data, not just queries.** Preserve the actual permitted response bytes and a manifest. Dataset-version pinning alone cannot guarantee identical future responses or continued upstream availability.
5. **Separate reliability concepts.** Source, inference, aggregation, local transformations, coverage and supplied confidence are distinct facets. Derivation depth is not a calibrated accuracy score.
6. **Use a small local application.** Prefer a browser UI served by a local Node process with a durable queue and user-writable storage. Deliver a prebuilt package; users should not need the upstream development toolchain.
7. **Use upstream as a reference, with selective reuse.** Its platform license and deployment assumptions make a wholesale fork a poor default for this repository. Component reuse requires an individual license and dependency review.
8. **Make the four-week review a working slice.** Demonstrate one reproducible AIS extract, recovery states, resolution controls and the VMS access decision, with visual concepts for broader parity. It is not a promise of complete phase-one delivery.

These are proposed product and engineering decisions, not claims that an application has been implemented or that restricted access has been granted.

## 2. Client context and intended users

| Input | Product interpretation | Traceability |
| --- | --- | --- |
| Fisheries science; compare sectors | Researchers need common areas and dates across fishing, vessel presence and offshore infrastructure; licensed mining boundaries may be imported. | R07, R10, R11 |
| VMS high priority | Discover usable country/fleet products and preserve their access conditions before committing to a data connector. | R02, G1 |
| High resolution; open-ended analysis | Expose the finest supported export grain and its cost; never infer fine observations from coarse data. | R05, R06 |
| Confusing existing UI | Test whether a task-led query builder reduces errors and helps users explain what they downloaded. | R01, usability protocol |
| Historical pulls | Persistent extraction plans, safe sequential batches, immutable snapshots and offline reopening. | R06, R08, R09 |
| Reliability and how derivative items are | Visible lineage and source-specific quality evidence, including unavailable evidence. | R12 |
| Terms of service | Per-source permissions and attribution form part of the capability contract and release gate. | R13, G0 |
| Local deployment, restricted installation, Node available | Validate the actual managed machine; assume neither administrative rights nor native package installation. “Intune” remains a likely environment detail to confirm. | R14, G2 |
| Client email/reports expected | Treat incoming reports as future evidence; allow local overlays and citations. No unseen report is assumed to support a requirement. | R10, open questions |
| Catch-up in four weeks, visual examples preferred | Prepare a task-based demo and visual comparison of proposed controls. Meeting date to be confirmed. | M1–M4 |
| “Safety” tracking / “OWS” blocked download | AIS is the likely meaning of safety-related tracking, pending confirmation. OWS is unknown; do not infer a protocol, provider or cause of denial. | Q04 |

Primary users are fisheries researchers who understand their scientific question but should not have to construct API calls. A secondary analyst needs inspectable queries and exports for R, Python or GIS. A local IT/support contact needs a predictable package, network requirements and safe diagnostics. The primary environment is desktop; smaller screens must retain query, table and download access.

### Key jobs

- “For this polygon and period, obtain the most detailed permitted activity data and explain exactly what each row represents.”
- “Find the VMS products available to me, understand their limits, and bring a permitted extract into my study.”
- “Compare two periods or sectors using consistent boundaries and clearly distinguished measures.”
- “Reopen last month's result without unknowingly using a revised upstream model.”
- “Hand another researcher the data, query, boundary and caveats needed to understand this figure.”

## 3. What parity includes

**P0** is the minimum useful phase-one release. **P1** is the planned breadth of phase one, sequenced after P0. **Conditional** requires the named evidence/access gate. **Deferred** belongs outside the agreed first release. Phase one is not declared complete until P1 items have either passed acceptance or been explicitly removed from scope with the client.

| Capability | Phase-one treatment | Boundary / acceptance evidence |
| --- | --- | --- |
| AIS apparent fishing activity map, filters and regional extracts | P0 | Public 4Wings adapter; saved grid/time/metric settings; reproduce a small extract. |
| Regional time series and flag/gear tables; permitted by-vessel summaries | P0 | Driven by the committed query or saved snapshot; retain broad/unknown classifications. Summary grouping is distinct from P1 identity search and conditional tracks. |
| Custom polygons and named areas | P0 | Draw/import GeoJSON; record geometry and boundary version, not just display name. |
| Fine-grid, historical, downloadable data | P0 | CSV and JSON plus original upstream archive; chunk only after edge semantics are validated. |
| Dataset/version catalogue and VMS discovery | P0 | Distinct view, API, import and redistribution capabilities; unknowns remain visible. |
| VMS local import | Conditional P0 priority | At least one authorized country/fleet sample and supported schema; absence of access is a documented gate, not successful VMS delivery. |
| VMS automated retrieval / tracks | Conditional | Written support/rights and a tested endpoint contract; never infer from source visibility. |
| Local saved studies and portable bundles | P0 | Export/import without tokens; reopen archived results with the same hashes. |
| AIS vessel presence; SAR detections | P1 | Independent measures, availability and filters; no combined “fishing hours” total. |
| Vessel search, identity and event inspection | P1 | Public identity/events APIs, pagination and source provenance; no promised raw positions. |
| GFW vessel insights | P1, lower priority | Display supplied indicators and caveats; no locally invented risk score. |
| AIS track visualization/export | Conditional | Publicly supported endpoint/permission, sampling and date limits confirmed; otherwise a GFW handoff and permitted import. |
| Period and dataset comparisons | P1 | Aligned areas, time bins, units and model versions; shared scales where comparable. |
| EEZ, MPA, RFMO and infrastructure context | P1 | Documented context layers; distinguish filtered infrastructure from bulk detections. |
| Client oil/mining reference layers | P1 | Local GeoJSON/CSV import with source, validity dates and license. Mining polygons are context, not evidence of active extraction. |
| GeoTIFF exports | P1 | Adapter verifies grid, CRS, orientation and nodata; do not infer metadata from a filename. |
| Locally saved vessel sets, annotations, screenshots and printable summaries | P1 | References retain dataset/identity versions; figures carry units, query and attribution. |
| VIIRS, Sentinel-2, voyages and environmental layers | Conditional / selected imports | Public API availability differs from map availability. No blanket endpoint promise. |
| Animation, advanced bivariate maps, cloud collaborative workspaces | Deferred unless reprioritized | Not required to answer the initial client jobs. Basic map/time navigation remains included. |
| Serverless hosting, team accounts, unattended cloud jobs | Deferred | Local deployment first; no shared personal token service. |
| New fishing models, causal impact inference, cross-source deduplication research | Phase two | Phase one supplies trustworthy inputs and descriptive outputs. |

The capability split is grounded in the [availability matrix](https://globalfishingwatch.org/global-fishing-watch-data-availability/), public API documentation and the [upstream source review](gfw-parity-evidence.md). It is intentionally narrower than the complete first-party platform.

## 4. Information architecture and interaction model

Use five visible destinations: **Explore**, **Extract**, **Compare**, **Downloads**, **Data & methods**. A study name and saved/unsaved indicator remain available across them. Explore and Extract share a canonical query but keep map presentation separate.

The extract builder presents: **source → area → time → detail → review**. These are sections in one editable page, not a mandatory sequence of modal dialogs. A persistent summary answers: “What data? Where? When? What does a row mean? Which version? What will be saved?” Advanced settings expand in place.

- **Explore:** reversible map interactions, an explicit preview label, table alternative and current source/units. Changing zoom affects display only.
- **Extract:** exact UTC dates, geometry, grid, time bin, grouping and filters. Changing draft settings marks prior results as belonging to the previous query. Run commits a new query revision.
- **Compare:** select two saved extracts or create a matched pair. A compatibility panel explains differences before plotting.
- **Downloads:** persistent jobs and saved artifacts, not transient toast messages. A successful download links to its data, manifest and caveats.
- **Data & methods:** capability catalogue, country-specific VMS status, methodology, licensing and missing evidence. Inaccessible products are explained rather than silently removed.

Default proposal: show a short recent period for exploration; require review of exact dates before extraction. Offer capability-filtered presets such as “Regional overview,” “Daily grid,” and “By vessel summary,” each showing its actual settings. A vessel-summary preset is enabled only for permitted report grouping; it does not imply tracks or identity-search access. Never label a preset “highest quality.” Initial grid/time defaults must be calibrated in the first performance spike, not asserted as suitable for every dataset.

## 5. Functional requirements and acceptance criteria

### R01 — Stable study and query state · P0

A study has a human title, description, canonical query revisions and references to artifacts. Each query captures source/version, metric, region, dates, aggregation, filters and requested format. Map viewport, palette and panel visibility are presentation state.

**Accept:** changing zoom or palette cannot change the extraction fingerprint; editing dates or geometry does. A stale chart is labeled with its originating revision. Reload restores the last saved study without automatically submitting a costly query. A portable study excludes credentials and explicitly indicates missing data files.

### R02 — Dataset and VMS capabilities · P0 / conditional

The catalogue exposes publisher, observing system, product, geography, date coverage, freshness, model version, units, supported dimensions, access route and permission evidence. Model actions separately: view, query, download, retain locally, transform, share/redistribute. Unknown is distinct from allowed and forbidden.

For VMS, inventory countries/fleets without implying comprehensive global coverage. Select an available pilot with the client after discovery. An import must identify country/provider, aggregation grain, units, dates, source file hash, applicable terms and what transformations are permitted. Do not assume that all VMS is only summarized or that all country products have the same schema.

**Accept:** a map-only item cannot enter the API job queue; an item of unknown export status says what remains unverified. Permission to view does not enable redistribution. No AIS fallback occurs without a visibly new source selection. An authorized sample is required before an import adapter is marked supported.

### R03 — Area selection and boundary semantics · P0

Support a named-area search, polygon drawing, coordinate entry and GeoJSON Polygon/MultiPolygon import. Show bounding box, coordinate order, approximate area and validation results. Preserve the original file and exact analysis geometry. Use WGS84 longitude/latitude for submitted GeoJSON. Do not silently simplify a boundary; preview any proposed simplification and store both versions.

**Accept:** holes and multipolygons retain their meaning; invalid/self-intersecting input is rejected with a useful message. Antimeridian and polar cases either pass an explicit test or fail before submission with a documented limitation. Changing a named boundary's upstream version does not silently alter an existing study. The UI distinguishes cell selection from fractional clipping; exact area weighting is not promised until verified.

### R04 — Time and historical selection · P0

Provide typed dates, calendar controls and presets, displaying UTC explicitly. The UI can show an inclusive end date for humans, while the normalized internal range is half-open `[start, end)`; the adapter translates it only after upstream inclusivity tests. Availability is per dataset; the chosen period must not silently snap into coverage.

**Accept:** leap days, month/year boundaries and unavailable periods have test fixtures. A mixed-source comparison displays its common coverage and any excluded dates. The same saved query produces the same requested time bounds in another timezone. Observed latest data and retrieval date are distinguished from a documented expected delay.

### R05 — Spatial and temporal resolution · P0

Show separate controls for **map display detail**, **saved spatial grain**, **saved time bin**, and **grouping**. Display the effective preview spatial detail and time interval, including automatic changes: for example, “Preview: monthly; saved extract: daily.” Zoom-relative display detail must not be labeled as a fixed export grid. Present source-supported degree grids directly. For latitude φ, a 0.01° cell is approximately 1.11 km north–south and 1.11 × cos(φ) km east–west; this is a size illustration, not positional accuracy. A fine grid does not imply fine source observations or more confidence.

**Accept:** the 0.1°/0.01° report choices are enabled only for validated products/combinations. Hourly output is conditional on the specific product contract; a global enum is insufficient. Regional totals disable irrelevant cell settings. Unsupported combinations explain the reason. No zoom change, large-volume warning or server response silently coarsens the saved output. A “what each row represents” example updates as controls change.

### R06 — Review and durable historical extraction · P0

Before execution, show the committed query, access conditions, approximate rows/bytes where measured, expected calls/chunks, storage location and available quota information. Label estimates as estimates and display “not calibrated” where no evidence exists. Large plans require explicit Run on the reviewed plan; do not invent precise duration predictions.

A durable queue submits at most one 4Wings report at a time through this application's local broker, shared by its tabs/processes. Other applications or machines can still occupy the account's remote slot; reconcile contention and uncertain results before retrying. Persist the plan and completed chunks before continuing. Time chunks are preferred over spatial splitting; preserve monthly/yearly bins across partitions. Pause stops future work; cancel does not claim to stop processing already running at GFW. Upstream recovery details are specified in the development plan.

**Accept:** interrupted jobs retain valid completed chunks and exact retry scope. A partial result is never labeled complete. A restart, duplicate click or second local tab does not create duplicate submissions. Whole-range and chunked fixture totals agree under the tested boundary rules. Incomplete unique-vessel counts are not presented as complete counts.

### R07 — Maps, charts and tables · P0 core; P1 breadth

Use the same committed query/snapshot for quantitative charts and tables. Live tiles may power navigation but must say “preview” when they differ from the export grain. Supply a data table and textual summary alongside the map. Tooltips expose source, period, unit and aggregation; palette legends show whether a scale is fixed or dynamic.

**Accept:** filtered subtotals reconcile with their extract within a defined numerical tolerance. The UI distinguishes zero returned activity, no rows, unavailable coverage, loading, blocked access and failed requests. Missing cells remain unknown unless the source contract explicitly defines absence as zero. Percentages state their denominator. Sum additive hours, not cell-level distinct-vessel counts; no chart labels apparent activity as catch or confirmed fishing.

### R08 — Historical sources and offline reopening · P0 snapshots; P1 static imports

Offer a saved snapshot when it satisfies the query, then a compatible static release/import once that P1 adapter is enabled, then a new API extraction. Show why a source matches or differs. Static releases and continuously revised API products remain distinct. Reuse only when version, geometry, grain, groups and filters support a lossless answer; never infer finer cells or vessel IDs from coarser aggregates.

**Accept:** a saved extract opens with the network disconnected and its original source/version visible. Its tables and charts remain usable even if basemap tiles are unavailable. A changed model or response checksum creates a new artifact, not an overwrite. No requirement to download the entire global historical release onto a managed laptop; import selected files and enforce disk/memory budgets.

### R09 — Exports and research handoff · P0; additional formats P1

The baseline export is a folder/ZIP containing the permitted data, `manifest.json`, exact boundary, data dictionary, source citations, license/caveat files and a human-readable query summary. Retain the upstream archive unchanged when supplied. Normalized CSV/JSON is a labeled derivative with a schema version; protect spreadsheet-oriented copies against formula injection while retaining unchanged raw data.

**Accept:** a second local installation can import the bundle, validate hashes and reconstruct the query without any token. Unsupported manifests remain readable but cannot be silently reinterpreted. An incomplete job bundle is labeled partial; valid saved chunks retain their own complete status and do not imply the whole job succeeded. Data licenses travel with outputs; a restrictive source cannot be made redistributable by wrapping it in this project's MIT license. GeoTIFF and optional Parquet require their own interoperability tests before inclusion.

### R10 — Sector and client reference layers · P1

Support local GeoJSON polygons/points and CSV coordinates with mapping/validation. Record source URL or supplied citation, owner, license, CRS, observation/validity dates and import checksum. Baseline processing stays local. Submitting a private study geometry to a remote report service requires a clear disclosure in the query review; arbitrary client uploads must not be silently sent to GFW.

Use fixed-infrastructure classifications as modeled detections, keeping their confidence fields and distinction from authoritative oil installations. Mining concessions, proposed areas and active operations need different labels. Overlay visualization and descriptive region reports belong to phase one; causal relationships, exposure models and statistical controls belong to phase two.

**Accept:** each overlay has its own legend and validity period. Incompatible units are never summed. Importing an unverified concession file does not label the area “active mining.” Unlicensed external datasets are not bundled in a release.

### R11 — Comparison workspace · P1

Provide two periods for one source or two sources for one area, with synchronized views and an explicit settings comparison. Offer absolute differences only for compatible units and grid/time semantics. A percentage change with zero or missing baseline is undefined and displayed accordingly. Different-duration periods require labeled normalization or an explicit unequal-duration comparison.

**Accept:** standard period comparisons require matching dataset/model version and geometry; a deliberate cross-version view is labeled “method/version comparison.” AIS and VMS remain separate unless a validated overlap method becomes available. Fine data may be coarsened with logged transformations; coarse data cannot be upsampled into invented detail. Saved comparison outputs name both parent artifacts and the transformation used.

### R12 — Source, derivation and confidence · P0

Every result has an expandable **Data & methods** panel with independent facets:

| Facet | Example values | User behavior |
| --- | --- | --- |
| Observation/identity source | AIS, country VMS, SAR, registry, client file | Filter or separate layers; expose provenance. |
| Upstream processing | Reported identity, modeled activity, classification, aggregation | Explain the measurement; preserve upstream pipeline version. |
| Local processing | Filter, rebin, spatial join, comparison | Show parents, parameters and code revision. |
| Supplied quality evidence | A documented class score, event level, infrastructure label, or unavailable | Filter only within the score's defined scope; retain unknown as a separate option. |
| Coverage and limitations | Reception changes, incomplete fleet coverage, limited imagery, missing dates | Keep caveats visible at comparison/export time. |
| Artifact integrity | Complete/partial, checksum, extraction and validation time | Determine whether a result is reproducible and usable. |

**Accept:** no universal confidence slider or invented percentage. A vessel-classification score cannot become fishing-activity confidence. Unknown quality is not zero quality. A lineage diagram can show an upstream inference followed by aggregation and local comparison without rating each step as less trustworthy. More detailed lineage and sourced examples are in the evidence review.

### R13 — Attribution and use conditions · P0

Maintain a permission record per data product and an inventory of third-party code. Link required GFW attribution on applicable maps/charts and include source/version/date citations in exports. Personal API tokens belong to individual users; no token is bundled with the application or shared with collaborators. The client has confirmed academic/non-commercial nonprofit use. Explicit VMS provider authorization remains unknown; clarify it at the next meeting. Verify dataset restrictions and the API terms' derivative-product wording before a live pilot/release. [API terms](https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits)

**Accept:** an export permission decision is traceable to metadata or an agreement, with a verification date. Unknown rights do not enable redistribution. A source-code license does not override data terms. A 403 produces an actionable access message, not an attempt to bypass a restriction. Branding must not imply GFW endorsement.

### R14 — Local setup and storage · P0

Deliver a versioned prebuilt archive with a launcher using an approved Node runtime, a browser UI, a writable data directory and a diagnostic command. The exact Node floor, browser and launcher format remain subject to the managed-machine spike. Developer tooling is separate from end-user runtime requirements.

**Accept:** a standard user can start, stop, reopen and uninstall on a representative managed Windows machine without Docker, Python, compilation, a global package install, a service install or an administrator prompt. Document network allowlists and proxy/certificate support without disabling TLS validation. If policy prevents local execution, record the IT action required; do not describe a workaround as compliant setup. Offline access covers saved artifacts, not future data acquisition.

### R15 — Accessible, understandable operation · P0

All essential query/download functions work with a keyboard and without the map. Use labeled controls, visible focus, sufficient contrast, text plus color for states, and reduced motion. A map is not the sole means of selecting coordinates or identifying results. Errors preserve user input and link to the affected field or job.

**Accept:** manual keyboard and screen-reader tasks pass alongside automated checks; the chosen accessibility target is [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/), to be verified against the standard during implementation. At 200% zoom controls remain reachable. Tables use real headers, pagination/virtualization does not hide accessible row context, and long jobs announce meaningful status changes without repeated noise.

### R16 — Vessel and event inspection · P1 / tracks conditional

Search identity by supported identifiers, preserve historical identities and distinguish self-reported from registry information. Fetch complete paginated event lists with explicit scope and source-specific quality labels. Do not equate one MMSI with one immutable vessel or join versions without a documented mapping.

**Accept:** pagination terminates safely and exposes partial failures. Events and activity hours remain separate products, so different totals are explained rather than forced to match. Gaps and unmatched detections are not labeled illegal activity. Track access, thinning, precision and export permissions must be verified independently of the Vessels API.

### R17 — Operability and diagnostics · P0

Present connectivity, storage, quota freshness, job state and supported capability status. Keep local structured logs with request fingerprints and safe error categories. Diagnostics export is previewable and redacted; telemetry is off by default.

**Accept:** no token, signed download URL or private geometry appears in a default diagnostic bundle. Disk-full, malformed response, interrupted download and unavailable dataset errors leave prior artifacts intact. Users can see what can be retried and what needs changed credentials, access or input.

## 6. Data model and scientific invariants

The implementation should use explicit records for `Study`, immutable `QueryRevision`, `DatasetCapability`, `BoundaryArtifact`, `ExtractionPlan`, `Job`, `Chunk`, immutable `Artifact`, and `Transformation`. Their relationship is specified in the development plan. A study is editable; an artifact's bytes and provenance are immutable.

Required invariants:

- Requested and catalogue-resolved dataset/model versions are recorded, along with any response-reported version. Check the latter against the request; if absent, record “response version unavailable” and the resolution evidence rather than invent a header. Actual bytes/checksums anchor reproducibility.
- A complete artifact has all expected partitions and validated hashes/schema; “no rows” is a valid outcome distinct from an error.
- Dataset version, time bins, spatial grid, units and identity grouping form part of a table's schema.
- Quantitative export provenance cannot depend on the current map viewport.
- Missingness survives transformations. An empty API result does not establish absence of real-world fishing.
- Additive measures and distinct counts have different aggregation rules. Regional uniqueness needs distinct identifiers or a dedicated source total.
- Source permissions and caveats propagate to derivatives and comparison bundles.
- A transformation never makes an inference look like a raw observation.

## 7. Success measures and release boundaries

These are proposed acceptance targets, not measured performance claims. Calibrate them with the client during discovery.

| Outcome | Proposed validation |
| --- | --- |
| Users understand their extract | In a pilot with 3–5 representative users, at least 4 of 5 task attempts correctly identify source, unit, grid, time bin and version without coaching; use counts, not statistical generalizations. |
| Reduced workflow friction | Run the same permitted extraction task in GFW and the prototype; record time, errors and help requests. Target a meaningful reduction agreed after baseline measurement; do not manufacture a current UI benchmark. |
| Reproducibility | All released demonstration extracts include validated manifests and can reopen without network access. |
| Recovery | All critical failure scenarios in the development plan pass without corrupting, duplicating or mislabeling data. |
| Local usability | Representative managed-machine setup completes without privileged installation; target under 15 minutes once Node and access are available, measured in the pilot. |
| Responsive interaction | Query edits respond within 200 ms; cached views for a declared reference fixture render within 2 seconds; upstream wait time is separately reported. These are budgets to test, not a service SLA. |
| Scientific interpretation | Reviewers can distinguish modeled activity, coverage gaps, supplied confidence and local derivatives in the demo. |
| Honest VMS status | Every advertised country/product has a dated access/rights record. Any unresolved availability is stated in the release scope. |

P0 acceptance is not “the map looks right.” It is the successful end-to-end selection, extraction, recovery, interpretation and local reopening of a permitted study. Complete phase-one acceptance additionally covers the agreed P1 matrix and an explicit disposition for every conditional capability.

## 8. Questions retained for discovery

| ID | Question | Owner / default until answered |
| --- | --- | --- |
| Q01 | Which available VMS territory and data grain offers the most useful first study? | Client + data lead; geography remains open, select after availability inventory. |
| Q02 | Does the client hold explicit VMS provider authorization or an authorized export/sample? For which country/product and permitted actions? | Next client meeting; authorization currently unknown. Confirm source-specific retention, transformation, publication and redistribution with GFW / relevant authority. |
| Q03 | What Node version, Windows build, browser, proxy and execution policies exist on actual client machines? | Client IT; baseline design avoids native installs. |
| Q04 | What was the blocked “OWS” download and its exact error/access context? Is “safety” AIS? | Client; unresolved, not a named service requirement. |
| Q05 | Which reports, oil/mining layers and example regions will the client supply? | Client; no external dataset chosen on their behalf. |
| Q06 | What typical/maximum area, date span, rows and storage size are useful? | Client + engineering; choose small measured fixtures first. |
| Q07 | Is the planned use and software distribution compatible with source-specific terms? | Client confirms academic/non-commercial nonprofit use. Product-specific authorization and acceptable distribution license still require review. |
| Q08 | How much vessel detail is scientifically necessary, versus gridded summaries? | Client; support summaries first, preserve identity limits. |
| Q09 | What staffing and actual review date apply? | Project lead; four-week milestone is relative to kickoff. |

The planned follow-up email is an input to these decisions, not a dependency for drafting this specification. The next step is the gated discovery and thin working slice in the development plan.
