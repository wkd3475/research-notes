---
title: 'Databricks Major Services: A Platform Survey'
---

## References

- [What is Databricks?](https://docs.databricks.com/aws/en/introduction/)
- [The scope of the Databricks platform](https://docs.databricks.com/aws/en/lakehouse-architecture/scope)
- [Databricks reference architectures](https://docs.databricks.com/aws/en/lakehouse-architecture/reference)
- [What is a data lakehouse?](https://docs.databricks.com/aws/en/lakehouse/)
- [What is Delta Lake in Databricks?](https://docs.databricks.com/aws/en/delta/)
- [What is Unity Catalog?](https://docs.databricks.com/aws/en/data-governance/unity-catalog/)
- [Connect to serverless compute](https://docs.databricks.com/aws/en/compute/serverless/)
- [Compute selection recommendations](https://docs.databricks.com/aws/en/compute/choose-compute)
- [SQL warehouse types](https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-types)
- [Migrate from classic compute to serverless](https://docs.databricks.com/aws/en/compute/serverless/migration)
- [Lakeflow: A new era of agentic data engineering](https://www.databricks.com/blog/lakeflow-new-era-agentic-data-engineering)

---

## Why I looked this up

Asked for a paper-style survey of Databricks’ major services, then for a senior-engineer-depth rewrite and deploy.

---

## What stood out

—

---

## What I learned

### Abstract

Databricks is best evaluated as a **layered control/data system**, not as “managed Spark.” The Data Intelligence Platform stacks (1) open table formats on customer object storage, (2) Unity Catalog as a cross-workspace data-and-AI control plane, (3) multiple compute planes (classic in-customer-VPC clusters, Databricks-managed serverless, SQL warehouses, Model Serving), and (4) persona-specific products (Lakeflow, Databricks SQL, Mosaic AI, Lakebase, Apps, OpenSharing). This note is a senior-oriented map: what each major service actually owns, where bytes and IAM live, and which trade-offs show up in design reviews.

### 1. Introduction — what “unified platform” really means

The lakehouse pitch is familiar: keep **object-storage economics** while recovering warehouse properties (ACID, schema, performant SQL) and serving ML from the same tables. Databricks’ stronger claim is **one governance plane for data and AI assets** (tables, volumes, features, models, serving endpoints) plus GenAI that reads that metadata (Genie, assistive coding, semantic/metric layers).

For a senior engineer, the useful questions are operational:

| Question | Why it matters |
|----------|----------------|
| Where does compute run? | Classic = your cloud account; serverless SQL/notebooks/jobs = Databricks-managed plane; Model Serving control plane is Databricks-hosted |
| Where is the source of truth for permissions? | Unity Catalog metastore vs legacy Hive metastore / IAM instance profiles |
| What is the table contract? | Delta (default) vs Iceberg; managed vs external; UniForm / open APIs for foreign engines |
| How does data move? | Connect / Auto Loader / Structured Streaming / Federation (query pushdown, no copy) |
| How do you observe cost and access? | `system.*` tables (billing, audit) vs ad-hoc cluster metrics |

### 2. Control plane, classic data plane, serverless plane

Treat Databricks as three coupled planes:

```
┌─────────────────────────────────────────────────────────┐
│ Control plane (Databricks account / region)             │
│  Workspace UI, Jobs API, UC metastore services,         │
│  Model Serving control, Notebooks metadata, …           │
└───────────────────────────┬─────────────────────────────┘
                            │ schedules / auth / policies
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
┌──────────────────────┐              ┌──────────────────────┐
│ Classic data plane   │              │ Serverless plane     │
│ (customer cloud acct)│              │ (Databricks-managed) │
│ Clusters, classic    │              │ Serverless notebooks │
│ SQL warehouse VMs,   │              │ / jobs / pipelines,  │
│ customer VPC/peering │              │ serverless SQL WH,   │
│ IAM roles / profiles │              │ NCC / Private Link   │
└──────────┬───────────┘              └──────────┬───────────┘
           │                                     │
           └──────────────┬──────────────────────┘
                          ▼
              Customer object storage (S3/ADLS/GCS)
              Delta / Iceberg tables + UC volumes
```

**Implications for reviews**

- **Data residency / blast radius:** table bytes stay in your buckets; metastore and serving control are Databricks-side. Ask where audit logs and system tables live and who can query them.
- **Networking migration:** classic patterns (VPC peering, instance profiles, `dbfs:/`) do **not** transfer cleanly to serverless. Official migration path: Unity Catalog + external locations, Network Connectivity Config (NCC) / Private Link, volumes instead of DBFS, Lakehouse Federation instead of custom JDBC JARs.
- **Serverless is versionless:** runtime rolls forward automatically. That is a feature for patch cadence and a constraint if you need pinned DBR + custom libs / RDD / R.

### 3. Storage contract — Delta Lake (and Iceberg)

**Delta Lake** is Parquet + a **file-based transaction log** with an open protocol. On Databricks it is the default table format. Guarantees seniors actually use:

| Mechanism | Engineering use |
|-----------|-----------------|
| ACID via transaction log | Concurrent writers/readers without corrupting directories; never hand-edit `_delta_log` |
| Schema enforcement on write | Reject bad batches at ingest; pair with expectations in Lakeflow |
| Schema evolution / column mapping | Evolve without full rewrites; rename/drop without rewriting files |
| Time travel / `DESCRIBE HISTORY` | Incident rollback, audit of who wrote what version |
| Change Data Feed (CDF) | Downstream incremental consumers without re-scanning full tables |
| Liquid clustering / data skipping / OPTIMIZE | Prefer liquid clustering over brittle partition keys for evolving query patterns; compact small files; VACUUM for retention/cost |
| MERGE / selective overwrite | CDC upserts and partition-scoped rewrites |

**Medallion** remains the default curation pattern (bronze → silver → gold as successive Delta tables). Lakeflow pipelines encode dependencies so gold does not silently run on stale silver.

**Iceberg / openness.** Managed tables can target Delta or Iceberg; UniForm / open APIs / credential vending let external engines (Spark, Trino, DuckDB, Iceberg REST clients) read under UC policy. Design reviews should state whether “open” means *format* only or *multi-engine write path* — those are different SLAs.

**Managed vs external tables (decision table)**

| | Managed | External |
|--|---------|----------|
| Storage lifecycle | UC owns location + cleanup | You own path; UC governs only |
| Default recommendation | Yes, for new lakes | Legacy lakes, shared buckets, partner-owned paths |
| Failure mode | Accidental `DROP` can delete data UC manages | Orphan files if you drop UC metadata but leave objects |

### 4. Unity Catalog — the real platform spine

UC is not “a nicer Hive metastore.” It is the **authorization, discovery, lineage, and AI-asset registry** that serverless and modern products assume.

**Object model.** Three-level namespace `catalog.schema.object` for tables, views, volumes, functions, models, model/MCP services. Metastore-level objects: storage credentials, external locations, connections, shares. Workspaces created after **2023-11-08** get UC by default.

**Capabilities that show up in production designs**

- Privileges + ABAC, row/column filters, **workspace bindings** (isolate which workspace sees which catalog)
- Runtime lineage into models, dashboards, services
- Audit + quality monitoring; anomalies and profiles
- **Lakehouse Federation:** map foreign SQL engines (Postgres, MySQL, Redshift, …) into UC; queries push down — no mandatory ETL copy
- **Catalog Federation:** bring Hive Metastore / Glue catalogs under UC policy without immediate physical migration
- OpenSharing + AI Gateway for outbound data and generative traffic

**Senior rule of thumb:** if a design still depends on Hive metastore tables, instance-profile paths, or `dbfs:/` for durable assets, it is on the **classic** path and will block or complicate serverless, predictive optimization, and several AI features. Federation is the bridge, not a permanent substitute for a clear ownership model on hot paths.

### 5. Compute selection — where work actually runs

Photon is Databricks’ **vectorized** engine under SQL warehouses (and many DataFrame/SQL paths). Warehouse type still matters more than “Photon yes/no” for ops:

| Compute | Runs in | Use when | Avoid when |
|---------|---------|----------|------------|
| **Serverless compute** (notebooks / jobs / Lakeflow) | Databricks serverless plane | Default automated ETL; fast start; UC-governed | Need RDD/R, exotic libs, pinned DBR, unsupported sources |
| **Classic jobs / all-purpose clusters** | Customer account | Custom Spark conf, GPUs, legacy HMS, deep library control | Paying for idle all-purpose for scheduled jobs |
| **Serverless SQL warehouse** | Databricks | BI / interactive SQL; seconds-scale start; IWM / Predictive IO | Legacy external HMS; some custom networking cases |
| **Pro SQL warehouse** | Customer account (typically) | Serverless unavailable; federation/hybrid networking needs | You wanted zero cluster ops |
| **Classic SQL warehouse** | Customer account | Legacy / entry-level only | New BI platforms — prefer serverless/pro |
| **Model Serving** | Databricks control plane endpoints | Low-latency inference, Foundation Model APIs | Treating it as a training cluster |

Serverless notebooks/jobs/pipelines require **UC-enabled** workspaces. Predictive optimization and data quality monitoring also bill under serverless infrastructure even when you did not manually start a serverless job — budget with `system.billing.usage`, accepting up to ~24h lag.

### 6. Ingest / transform / orchestrate — Lakeflow and streaming

**Lakeflow** consolidates three surfaces that seniors previously assembled from Auto Loader + DLT + Jobs:

1. **Connect** — managed connectors from SaaS/DBs → UC Delta tables (serverless + pipelines). Incremental read/write oriented.
2. **Pipelines** (declarative) — dataset graph, expectations (data quality gates), streaming tables / materialized views, infra scaling.
3. **Jobs** — multi-task orchestration across notebooks, SQL, Spark, dbt, ML, pipelines; CI/CD via Declarative Automation Bundles / Git folders.

**Path selection for CDC / files**

| Pattern | Typical path |
|---------|----------------|
| Files landing in cloud storage | Auto Loader → bronze Delta (or `COPY INTO` for simpler SQL incremental loads) |
| SaaS / DB connectors | Lakeflow Connect |
| Event buses (Kafka/Kinesis) | Structured Streaming → Delta; then medallion |
| CDC to queue then stream | Queue → Structured Streaming |
| CDC dumped as files | Auto Loader (batch-shaped CDC) |
| Need query without copy | Lakehouse Federation (accept source load + pushdown limits) |

Idempotency and exactly-once *semantics* still depend on Delta commits + well-designed MERGE/CDF — the platform removes plumbing, not data-contract design.

### 7. Databricks SQL, semantics, and BI

Databricks SQL is **SQL compute + UX on the same UC tables**, not a proprietary warehouse store. Analysts hit serverless/pro warehouses; external BI (Tableau, QuickSight, …) connects to the same engine.

Layered products on top:

- **Metric views / UC semantics** — define KPIs once; avoid N conflicting dashboard SQL dialects
- **AI/BI Dashboards** — assisted authoring on governed metrics
- **Genie** — NL→SQL over curated datasets + samples + glossary; quality tracks how carefully you scoped the agent’s corpus
- **AI Functions** — LLM calls inside SQL pipelines (cost/latency/PII review required)

Credential passthrough is **not** the warehouse story — UC is.

### 8. Mosaic AI / ML lifecycle

Traditional ML: ML runtimes, AutoML, **MLflow**, Feature Store + Model Registry **inside UC**, Jobs for training orchestration, Model Serving for online inference.

GenAI additions: Foundation Model APIs on serving, RAG/agent apps on UC data, **AI Gateway** for policy/monitoring on generative endpoints. External frameworks (OpenAI, LangGraph, Hugging Face) can be called from the platform; governance still wants UC + Gateway rather than unbounded personal keys in notebooks.

**Review checklist:** feature tables and model versions are UC securables; serving endpoints are not “outside” the lakehouse permission model; evaluate online feature path (Lakebase / feature serving) separately from batch training reads.

### 9. Lakebase, Apps, sharing

| Service | Senior take |
|---------|-------------|
| **Lakebase** (managed Postgres OLTP) | Puts transactional state next to the lakehouse with sync hooks to features/SQL/Apps — reduces the “Redis/RDS outside governance” default, but you still design consistency between OLTP writes and lake freshness |
| **Databricks Apps** | Serverless-hosted apps on platform identity/data; prefer Lakebase when the app needs true OLTP |
| **OpenSharing** | Live, governed share of object-store data; Marketplace and Clean Rooms build on it |
| **Clean Rooms** | Multi-party compute without mutual raw data exposure |

Internal share = GRANT. External share = OpenSharing contract (recipients, rotation, revocation), not S3 pre-signed URL folklore.

### 10. Observability and FinOps hooks

- **System tables** — account operational store for audit, billing, lineage consumers
- **Data quality monitoring** — profiles/anomalies (serverless-backed)
- **Billable usage** — attribute DBUs to jobs/warehouses; do not trust UI alone for chargeback

### 11. Synthesis diagram

```
Sharing / Apps     OpenSharing · Marketplace · Clean Rooms · Apps
Serve              SQL WH · Model Serving · Lakebase · AI Gateway
Query / Process    Spark · Photon · ML runtimes · MLflow
Transform          Lakeflow pipelines · Structured Streaming
Ingest             Connect · Auto Loader · partner/batch · CDC streams
Govern             Unity Catalog (+ Federation, quality, lineage, audit)
Store              Delta / Iceberg on customer object storage
Planes             Control · Classic data · Serverless
```

**Design thesis.** Pick the **storage contract** (managed Delta + medallion) and **governance contract** (UC metastore, external locations, no durable DBFS) first. Then choose **compute plane** per workload class. Products (SQL, Mosaic, Lakebase, Apps) are consumers of those contracts — not parallel platforms.

### 12. Conclusion

A senior reading of Databricks is: open tables on your storage; UC as the cross-cutting control plane for data *and* AI; multiple compute planes with very different networking/IAM assumptions; Lakeflow/SQL/Mosaic/Lakebase as workload UIs on that substrate. The failure mode is treating notebooks + classic clusters + Hive metastore as “Databricks” while the rest of the platform has already moved to UC + serverless. Deeper follow-ups: UC privilege/isolation model, Lakeflow pipeline execution semantics, Photon/SQL warehouse sizing, Model Serving + AI Gateway.

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Why is “serverless vs classic” a networking/IAM decision, not just a cost slider?
---
Classic compute runs in the customer cloud account (VPC, instance profiles, peering patterns). Serverless runs in a Databricks-managed plane and expects UC external locations, NCC/Private Link, and volumes — legacy `dbfs:/`, HMS, and instance-profile paths often break or are unsupported.
:::

:::quiz
**Q2.** What does Delta’s transaction log buy you that “Parquet in S3” does not, in production terms?
---
ACID commits, concurrent readers/writers without directory corruption, schema-on-write enforcement, time travel/history, and CDF for incremental downstreams — all via an open log protocol rather than hoping object listings stay consistent.
:::

:::quiz
**Q3.** When do you choose Lakehouse Federation over Lakeflow Connect / Auto Loader?
---
When you need governed query access with pushdown to an external SQL system **without** copying into the lake first. Use Connect/Auto Loader when you need lake-resident medallion tables, SLAs decoupled from the source, or heavy transform/history on Delta.
:::

:::quiz
**Q4.** Name two Unity Catalog features that matter specifically for multi-workspace enterprises.
---
Account-scoped policies across workspaces; **workspace bindings** to isolate catalog visibility; plus shared lineage/audit. (Also metastore-level credentials/locations/shares.)
:::

:::quiz
**Q5.** Why can billing show serverless job SKUs even if nobody clicked “serverless job”?
---
Features like data quality monitoring and predictive optimization run on serverless infrastructure and bill under serverless job usage — inspect `system.billing.usage`, not only manually started jobs.
:::

---

## Memo

—
