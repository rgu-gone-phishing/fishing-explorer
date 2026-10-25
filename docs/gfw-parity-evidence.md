# GFW parity evidence and design critique

**Reviewed 23 October 2026.** This accompanies the [specification](parity-phase-specification.md) and [development plan](parity-phase-development-plan.md). It records the evidence behind scope decisions; it is not a live API certification or a usability study.

## Review method and limits

- Read the repository's [9 October feasibility study](gfw-api-feasibility.md), including its reported v4 authenticated measurements. Those are historical observations; they were not rerun.
- Read current official GFW product/API documentation and release notes. Contradictions are recorded below instead of silently choosing the most permissive interpretation.
- Shallow-cloned `GlobalFishingWatch/frontend`, branch `develop`, at **`2b800a2974bc3721e239a1adcb73dea62545bed0`**, committed 22 October 2026. Inspected source without installing dependencies or running the application. [Checkout record](../references/README.md)
- Followed the upstream source-review guidance, including its local Nx workspace skill. No resolved Nx build configuration or production behavior is claimed from a static file read.
- Attempted a public-map browser inspection, but browser control timed out before useful UI evidence was obtained. No live interaction, accessibility audit, download experiment or client usability test is claimed.
- Did not read the local credential, submit new authenticated API requests, contact GFW, or download fishing datasets during this review.

Evidence labels: **documented** = current official statement; **source-observed** = behavior in the pinned checkout; **historically measured** = prior project probe; **proposed** = design judgment; **unverified** = needs a probe, rights confirmation or user research. The branch snapshot may differ from deployed production.

## Material findings

### 1. VMS is a priority access investigation

The current [Data Availability matrix](https://globalfishingwatch.org/global-fishing-watch-data-availability/) allows for map downloads in select VMS countries while listing no public API implementation. In contrast, the [raw-VMS FAQ](https://globalfishingwatch.org/faqs/can-i-download-raw-vms-data/) describes national ownership and restrictions beyond map display. The [user guide](https://globalfishingwatch.org/user-guide/) also contains a blanket no-download statement. These cannot be generalized into either universal availability or universal prohibition.

**Decision:** maintain a country/fleet/product/action registry with dated evidence. Map viewing, aggregate export, identity, tracks, local retention and redistribution are distinct permissions. Baseline is discovery plus import of a permitted file; direct integration is conditional. The client has no selected geography and wants whichever areas are available. No eligible country or partner API was verified here.

GFW's [AIS/VMS factsheet](https://globalfishingwatch.org/fact-sheet/how-ais-and-vms-tracking-technologies-work-10-essential-questions-answered/) describes complementary tracking systems with different control, coverage and reporting characteristics. It does not supply a general rule for deduplicating their aggregates. **Design implication:** keep AIS and VMS separate by default; do not add them into an implied total fleet estimate.

### 2. The existing v4 baseline is now historical

The [v5 release announcement](https://globalfishingwatch.org/platform-update/version-5-data-pipeline-release/) is dated **21 October 2026**. It describes historical reprocessing and changes to activity/classification models and reference information. It also says v4 remains static until April 2027. That specific retention statement differs from the general retirement policy in [Key Concepts](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts); confirm any replay deadline rather than treating it as guaranteed.

Key Concepts now maps `latest` to v5 and identifies `x-datasets` as response version evidence. API v3 is a route/interface version; dataset v5 is a data/model version. These are separate fields.

**Decision:** resolve a study's versions, record response-reported versions where supplied, and preserve permitted response bytes. Standard period comparisons use a consistent product/model version. A deliberate v4/v5 comparison is a methods comparison, not evidence of a real-world trend. Existing v4 measurements retain their original labels.

### 3. Fine grids already exist; the opportunity is explicit semantics

The public [report contract](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report) documents degree-grid or regional aggregation, multiple time/group options and output formats. It also specifies one concurrent report per user and timeout recovery. Enum spelling and container examples are inconsistent with each other and with prior observed JSON. Enable combinations after contract tests, not solely because an enum exists.

The [tile documentation](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/tiles) describes zoomed, time-binned display products and interval-dependent span limits. Its prose and interval enum also differ. The [interaction endpoint](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/interaction) can retrieve information behind a tile cell, but neither a cell lookup nor a rendered image is a complete regional extraction.

**Decision:** display effective preview grain, saved grain and row meaning separately. Grid size is aggregation scale, not positional accuracy. Treat hourly/fine options as product-specific. Do not claim 0.001° merely because upstream contains a disabled control.

### 4. Recovery exists, but durable research jobs add value

The [last-report contract](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/last-report) describes running, completed, failed and absent responses and a 30-minute post-generation retention window. The source already polls it after timeouts. It is not a durable per-job queue.

**Proposed engineering improvement:** retain job intent, chunk history, file integrity and offline results independently of a browser session. Correlate any recovered payload conservatively: a report initiated elsewhere on the same account can make a “last result” ambiguous. A local queue cannot reserve the account's remote slot against other clients.

### 5. Public API parity is narrower than map parity

The [Vessels API](https://globalfishingwatch.org/our-apis/documentation/docs/v3/vessels) documents identity search/detail; that does not establish general raw-position access. The [Events API](https://globalfishingwatch.org/our-apis/documentation/docs/v3/events) supplies distinct event products and pagination. The [Context Layers API](https://globalfishingwatch.org/our-apis/documentation/docs/v3/datasets) supplies region references and infrastructure context. The [Bulk Download API](https://globalfishingwatch.org/our-apis/documentation/docs/v3/bulk-download) currently targets infrastructure, including less-filtered detections than the context/map product.

**Decision:** preserve separate adapters and measurement units. Tracks and map-only products require their own access contracts. Infrastructure bulk output is not interchangeable with filtered map data, and is not a fishing-effort bulk route. Deep-sea-mining context will require a separately sourced, licensed layer; its existence does not establish operational activity or environmental effects.

### 6. Confidence needs a product-specific meaning

GFW's [apparent-activity methods](https://globalfishingwatch.org/detailed-apparent-fishing-activity/) explain model inference and processing, including differences between activity and event products. The [vessel-classification documentation](https://globalfishingwatch.org/datasets-and-code-vessel-classifications/) discusses broad fallback classes and model scores; `combinedSourcesInfo.atomicClassSc` needs schema validation before use. It must not be relabeled fishing confidence.

The [API data caveats](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats) include product-specific quality meanings, such as discrete port-visit levels. They are not interchangeable probabilities. The [activity dataset overview](https://globalfishingwatch.org/dataset-and-code-fishing-activity/) describes incomplete fleet/reception coverage, changing observation conditions and periodic static downloads.

**Decision:** implement separate source, upstream inference, aggregation, local transformation, supplied quality and coverage facets. No model-wide accuracy statistic becomes a per-cell score. More derivation is not automatically less reliability. Retain broad/unknown vessel classes and explain what a specific-gear filter excludes. Neither a gap nor an unmatched detection proves illegality.

### 7. Terms and code licenses need targeted decisions

The [API terms](https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits) specify noncommercial use, personal tokens, attribution and dataset-specific restrictions. They also contain broad derivative-product wording; clarify its application to this alternative frontend before the live pilot. The documented request budget is 50,000/day and 1.5 million/month per user across tokens; usage counters may lag. Do not rotate tokens to avoid limits.

The [website terms](https://globalfishingwatch.org/terms-of-use/) prohibit scraping for data and distinguish software from content licensing. **Decision:** reviewing intentionally published source is useful reference work, but it grants no additional dataset access. Record the client's use basis and actual export rights. Continue specification and synthetic prototype work while resolving these specific questions; this review is not a legal clearance.

Source licensing is independently material: the root package declares MIT, whereas `apps/platform/LICENSE` is GPLv3. Selected packages have their own declarations. Keep this repository's license unchanged and review any copied component with its dependency/notice obligations.

## Source review

All links below are pinned to the inspected commit. “Opportunity” is an inference to test with researchers, not a demonstrated usability defect. The strongest critique is how many related concepts a researcher must reconcile across exploration, report and export flows—not that GFW lacks those tools.

| Topic | Source-observed behavior | Proposed value and test |
| --- | --- | --- |
| Spatial display detail | [Activity controls](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/workspace/activity/activity.hooks.tsx#L92) offer icon-based low/default/high choices, including restrictions with vessel groups. [Heatmap utility](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/deck-layers/src/layers/fourwings/heatmap/fourwings-heatmap.utils.ts#L595) implements zoom offsets. | Label effective display detail and independent saved grid. Test whether users can explain why zooming does not change export grain. |
| Temporal display detail | [Interval selection](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/deck-loaders/src/fourwings/helpers/time.ts#L6) chooses supported intervals based on span. | Show automatic preview aggregation beside explicit export bins. Test recognition of monthly preview versus daily output. |
| Export discovery | [Activity modal](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/DownloadActivityModal.tsx#L44) separates By Vessel, Gridded and Environment paths. | Task-led entry points plus a persistent query summary. Measure discovery/error rates before claiming improvement. |
| Export choices/defaults | [Configuration](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/downloadActivity.config.ts#L41) enables CSV/JSON/GeoTIFF; [grid options](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/downloadActivity.config.ts#L121) include 0.1°/0.01°, with 0.001° disabled. [Gridded form](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/DownloadActivityGridded.tsx#L94) starts with first format and inherits timebar choices. | Persist intended output and show row meaning before Run. Avoid marketing existing fine-grid export as a new capability. |
| Long-range controls | [Map configuration](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/data/map/config.ts#L37) has an overridable 366-day report guard; [gridded form](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/DownloadActivityGridded.tsx#L294) handles range restrictions. | A permitted multi-request historical plan with manifest and resume. Verify public policy/semantics before enabling partitioning. |
| Permission and partial scope | [Permission helpers](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/datasets-client/src/permissions.ts#L24) distinguish reports and tracks. The [form](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/DownloadActivityGridded.tsx#L148) filters unauthorized datasets and [warns about exclusions](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/DownloadActivityGridded.tsx#L299). | Credit the warning; make exclusions part of an explicitly revised plan and retained manifest. Test that users understand export scope. |
| VMS heterogeneity | [Dataset mappings](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/datasets-client/src/migrations/datasets.latest.ts#L3) contain country/product-specific IDs and versions. | Treat IDs as candidates for discovery, not verified entitlements. Avoid a universal VMS schema or availability claim. |
| Recovery | [Download state](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/downloadActivity.slice.ts#L71) fetches the last report after timeouts. | Add persistent research-job/chunk history and safe recovery correlation; do not claim GFW has no recovery. |
| Tracks | [Track modal](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/DownloadTrackModal.tsx#L55) applies Medium thinning outside the GFW user group. | Disclose sampling and rights. Do not call these raw/full-detail AIS positions or simply remove restrictions. |
| Comparisons | [Period comparison](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_reports/tabs/activity/ReportActivityPeriodComparison.tsx#L100) and [dataset comparison](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_reports/tabs/activity/ReportActivityDatasetComparison.tsx#L61) already exist, alongside bivariate activity views. | Add a saved-artifact compatibility view and explicit units/coverage. Test interpretation, not just visual preference. |
| Explanation and reports | [Dataset information](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/content-panel/datasets-info/DatasetInfoContainer.tsx#L100) presents descriptions; [report title/actions](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_reports/report-area/title/ReportTitle.tsx#L135) support print/PDF. | Put key caveats at query/export decisions and include machine-readable provenance. Do not claim GFW lacks reports or explanations. |
| Quantitative rendering architecture | [Reports README](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_reports/README.md#L20) describes layer/feature-derived report processing. | Separate archived research data from preview rendering. This is an architectural preference, not evidence that GFW totals are wrong. |
| API-client defaults | [Client configuration](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/api-client/src/config.ts#L7) falls back to a development gateway. | Set the verified production host explicitly; audit before library reuse. |
| Build/runtime | [Root package](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/package.json#L10) requires Node >=24 and pins pnpm 12.10.1. [Platform README](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/README.md#L3) describes SSR tooling and product-specific local authentication setup. | End users receive prebuilt assets and a local JS service. “Node available” is not enough to guarantee an upstream checkout runs on a managed desktop. |
| Code license | [Platform license](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/LICENSE#L1) contains GPLv3; [root](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/package.json#L5) and [API client](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/api-client/package.json#L5) declare MIT. | Review actual reused files/packages and dependencies. Do not infer a single monorepo-wide permissive license. |

### API usage reference map

Use these files as request-construction examples, then cross-check public contracts:

- [Report request builder](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/download/downloadActivity.slice.ts#L132): indexed datasets/filters, time range, area and aggregation.
- [Endpoint templates](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/datasets-client/src/endpoints.config.ts#L47) and [resolution logic](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/libs/datasets-client/src/resolve-endpoint.ts#L9): product-specific query construction.
- [Remote workspaces](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/workspace/workspace.slice.ts#L174) and [BigQuery flow](https://github.com/GlobalFishingWatch/frontend/blob/2b800a2974bc3721e239a1adcb73dea62545bed0/apps/platform/features/_map/bigquery/bigquery.slice.ts#L41): first-party service coupling to avoid assuming is public API functionality. Keep local study files independent of those services.

## Conflicts and missing evidence to resolve

| Question | Evidence tension / gap | Required action |
| --- | --- | --- |
| VMS export scope | Current matrix says select countries; guide/FAQ are more restrictive. | Confirm exact country, product, grain and rights with GFW/authority; acquire one permitted sample. |
| Freshness | Key Concepts uses roughly 96 hours for AIS; other product pages retain 72 hours. | Show per-source checked/observed freshness; do not promise one universal lag. |
| Version retention | v5 release says v4 static until April 2027; general policy differs. | Confirm retention if replay is needed; preserve permitted artifacts now rather than rely on API longevity. |
| Report format / enum | Documentation includes inconsistent high-resolution spelling and generic ZIP wording; historical JSON was direct. | Probe exact v5 method/format combinations; content/schema validation. |
| Tile intervals | Public prose and enums differ; source adds metadata-driven defaults. | Verify each enabled interval/product/span and display effective behavior. |
| Tracks | Guide statements conflict; source contains permission/thinning logic; public identity docs do not establish track rights. | Verify supported route, access, sampling and retention independently. |
| Boundaries and batching | No new measurement of inclusivity, cell clipping or large-request envelope. | Small controlled equivalence tests before broad historical retrieval. |
| Static downloads | Old study describes a specific 2012–2024 release; current overview emphasizes snapshots without verifying that exact release schema here. | Discover actual release/version/coverage from its metadata and sample; do not hardcode old coverage as current. |
| Usability | Client frustration is reported, but no comparative task study was conducted. | Observe real tasks in both interfaces and test proposed explanations. |
| Local environment | Node availability stated; version/policies and “Intune” details unknown. | Run G2 on a real managed account before committing dependencies. |
| OWS | User confirms its meaning remains unknown. | Preserve the note and ask for the original report/error context when available. |

The source snapshot, dated links and explicit unknowns make the proposal reviewable. They do not imply that every documented feature is available to the client's account or that a development-branch behavior is deployed.
