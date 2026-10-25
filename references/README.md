# Upstream reference checkout

`gfw-frontend/` is an ignored, read-only research checkout of
[GlobalFishingWatch/frontend](https://github.com/GlobalFishingWatch/frontend).
It is not a dependency, submodule, or part of Fishing Explorer's distributable source.

| Field | Value |
| --- | --- |
| Retrieved | 2026-10-23 |
| Branch | `develop` |
| Commit | `2b800a2974bc3721e239a1adcb73dea62545bed0` |
| Commit time | 2026-10-22T18:24:04+02:00 |
| Commit subject | Post release fixes 2 (#4513) |
| Checkout | Shallow, one branch; no dependencies installed and no application run |

Reproduce the inspected revision from the repository root:

```sh
git clone --no-checkout https://github.com/GlobalFishingWatch/frontend.git references/gfw-frontend
git -C references/gfw-frontend checkout --detach 2b800a2974bc3721e239a1adcb73dea62545bed0
```

The initial research download used a shallow clone of `develop`; the instructions above intentionally fetch history so they remain usable after that branch advances. Check the commit before following source links in the [evidence review](../docs/gfw-parity-evidence.md).

Licensing must be checked per component: the root package declares MIT, while `apps/platform/LICENSE` contains GPLv3. A root declaration is not sufficient clearance to copy platform code into this MIT repository. Review dependency licenses, notices, data terms and branding separately before reuse.
