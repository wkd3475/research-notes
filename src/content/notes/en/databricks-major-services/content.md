---
title: 'Databricks Major Services: A Platform Survey'
---

## References

- [What is Databricks?](https://docs.databricks.com/aws/en/introduction/)
- [The scope of the Databricks platform](https://docs.databricks.com/aws/en/lakehouse-architecture/scope)
- [What is a data lakehouse?](https://docs.databricks.com/aws/en/lakehouse/)
- [What is Unity Catalog?](https://docs.databricks.com/aws/en/data-governance/unity-catalog/)
- [Databricks reference architectures](https://docs.databricks.com/aws/en/lakehouse-architecture/reference)
- [Lakeflow: A new era of agentic data engineering](https://www.databricks.com/blog/lakeflow-new-era-agentic-data-engineering)

---

## Why I looked this up

Asked for a paper-style survey of Databricks’ major services.

---

## What stood out

—

---

## What I learned

### Abstract

Databricks positions itself as a **Data Intelligence Platform**: a lakehouse-based, open stack for ETL, analytics/BI, and ML/AI, with generative AI layered on top of platform metadata. This note surveys the major services as documented in the official platform scope — storage (Delta Lake on cloud object storage), governance (Unity Catalog), ingest/transform/orchestration (Lakeflow, Auto Loader, Structured Streaming), warehousing (Databricks SQL), ML/AI (MLflow, Model Serving, AI functions), operational OLTP (Lakebase), apps, and cross-org sharing (OpenSharing / Marketplace / Clean Rooms). The organizing claim is simple: one open data foundation plus one governance plane, with workload-specific compute and tools on top.

### 1. Introduction

Enterprise data stacks historically split into a **data lake** (cheap, flexible object storage; weak transactions and governance) and a **data warehouse** (strong SQL/BI; costly, less friendly to ML and unstructured data). Teams then duplicated pipelines, catalogs, and access policies across systems.

Databricks’ answer is the **lakehouse**: warehouse-grade reliability and governance on lake-cost storage, with a single source of truth for engineers, analysts, and ML practitioners. The current product framing adds a **data intelligence engine** — GenAI that uses lakehouse metadata (schemas, lineage, business semantics) so search, coding assistance, and natural-language analytics sit on the same governed data.

This survey maps that framing to concrete services. It is a structural overview, not a how-to for any one product area.

### 2. Platform frame: domains and personas

Official docs describe the modern data/AI platform as stacked **domains**: storage, governance, AI engine, ingest/transform, advanced analytics/ML/AI, data warehouse, operational database, automation, ETL/DS tools, BI tools, data/AI apps, and collaboration/sharing.

**Personas** cut across those domains: data engineers (reliable ETL), data scientists (models and insight), ML engineers (production serving), business analysts/users (dashboards and questions), app developers (secure data apps), and external partners (shared data products).

Databricks claims coverage of all domains on one foundation, with **Apache Spark / Photon** as the primary compute engines and **Unity Catalog** as the central data-and-AI governance solution.

### 3. Storage foundation: cloud object storage and Delta Lake

All lakehouse data lives in the customer’s cloud object storage (AWS, Azure, or GCP). Databricks does not invent a proprietary on-disk format for the lakehouse core: **Delta Lake** is the recommended table format (ACID file transactions, schema enforcement, updates, time travel via the transaction log). Tables can also interoperate with **Apache Iceberg** clients; Unity Catalog managed tables are recommended for both Delta and Iceberg where supported.

| Property | Role in the lakehouse |
|----------|------------------------|
| Cloud object storage | Scalable, durable physical home for files |
| Delta Lake | Reliability layer: transactions, consistency, schema, versioning |
| Open formats | Avoid lock-in; external engines can read via open APIs / credential vending |

Raw structured, semi-structured, and unstructured files land first; conversion to Delta (or Iceberg) tables is where schema checks and governance registration typically begin.

### 4. Governance: Unity Catalog

**Unity Catalog** is the unified governance layer for data and AI. Once enabled on a workspace, it sits under queries and model calls: access control, lineage, discovery, and audit logging. Workspaces created after 2023-11-08 enable it by default; older workspaces can upgrade. An open-source Unity Catalog implementation also exists.

**Object model.** Governable assets are securable objects. Data and AI assets (tables, views, volumes, functions, models, model/MCP services) use a three-level namespace: `catalog.schema.object`. Tables and volumes may be **managed** (Unity Catalog owns storage lifecycle) or **external** (governance only). Credentials, external locations, connections, and shares hang under the metastore.

**Capability set.**

| Capability | What it provides |
|------------|------------------|
| Access control | Privileges, ABAC, row/column filters, workspace bindings |
| Discovery | Catalog Explorer and related UIs/APIs |
| Lineage | Automatic tracking from sources through models, services, dashboards |
| Auditing | System-table audit logs of data access and activity |
| Classification & quality | Tagging/classification; profiling and quality monitoring |
| Federation | Lakehouse Federation brings external SQL sources under UC governance |
| Sharing & AI governance | OpenSharing; AI Gateway for generative model traffic |

Unity Catalog is the spine that lets ETL, SQL, and ML share one policy and metadata plane instead of three catalogs.

### 5. Ingest, transform, and orchestration: Lakeflow and streaming

**Lakeflow** is the unified data-engineering surface: Connect (ingestion), pipelines (declarative transform), and Jobs (orchestration).

- **Lakeflow Connect** — built-in connectors from enterprise apps and databases into Unity Catalog–governed Delta tables, typically on serverless compute and Lakeflow pipelines.
- **Auto Loader** — incremental, idempotent ingestion of files landing in cloud storage without manually tracking state.
- **Lakeflow pipelines** — declarative ETL with dataset dependencies, scaling, and **expectations** for data quality.
- **Lakeflow Jobs** — schedule and orchestrate notebooks, SQL, Spark, dbt, ML workloads, and pipelines across clouds.
- **Structured Streaming** — Spark streaming tightly coupled to Delta; foundation for incremental pipelines and Auto Loader patterns.

Together these cover batch and streaming paths into the same governed tables that BI and ML consume.

### 6. Data warehouse and BI: Databricks SQL

**Databricks SQL** is the warehouse/BI product on the lakehouse: SQL warehouses (including serverless options), SQL editor, and integration with external BI tools. Fine-grained access is enforced through Unity Catalog.

On top of SQL:

- **Unity Catalog semantics / metric views** — define KPIs once; query across dimensions as a shared semantic layer for people and AI tools.
- **AI/BI Dashboards** — AI-assisted dashboard authoring and visualization.
- **Genie Agents** — natural-language exploration configured with datasets, sample queries, and domain language.
- **AI Functions** — call LLMs and AI capabilities from SQL for enrichment inside analytic workflows.

Warehousing here is not a separate silo of proprietary storage; it is SQL compute and UX over the same Delta/UC tables.

### 7. ML, AI, and Mosaic AI surfaces

Databricks ML builds on Spark runtimes, **MLflow** (experiment tracking and model lifecycle), Feature Store and Model Registry (integrated with Unity Catalog), AutoML, and libraries such as Hugging Face Transformers for LLM customization.

Serving and genAI product surfaces commonly appear under **Mosaic AI**:

- **Model Serving** — scalable real-time endpoints in the Databricks control plane (including Foundation Model APIs for hosted models).
- **AI Gateway** — govern and monitor access to generative models and serving endpoints.
- Broader agent/framework tooling for production AI apps on governed data.

The architectural point is the same as for SQL: models and features are first-class Unity Catalog assets, not a parallel shadow registry.

### 8. Operational database: Lakebase

**Lakebase** is a managed **Postgres** OLTP database integrated with the Data Intelligence Platform. It supports transactional workloads beside the analytical lakehouse, with sync paths between OLTP and OLAP, and integration hooks to Feature management, SQL warehouses, and Databricks Apps. This closes a historical gap where “online” serving stores lived outside the lakehouse governance story.

### 9. Apps, collaboration, and sharing

| Service | Role |
|---------|------|
| **Databricks Apps** | Build and host secure data/AI applications on platform data under UC |
| **OpenSharing** | Open protocol for secure live sharing across orgs and compute platforms (managed via Unity Catalog) |
| **Databricks Marketplace** | Forum for discovering/exchanging data products via OpenSharing |
| **Clean Rooms** | Multi-party analysis on sensitive data without direct peer data access, using OpenSharing + serverless compute |

Internal sharing can be as simple as granting table/view privileges; external sharing uses the open sharing stack rather than ad-hoc file drops.

### 10. Control plane vs data plane (brief)

Databricks manages a **control plane** (workspace UI, Job scheduling, Model Serving control, governance services) while **data** typically remains in the customer’s cloud account storage and customer-scoped compute. That split matters for security reviews: policies and metadata are centralized; bytes stay in the cloud you already trust for the lake.

### 11. Synthesis: how the major services fit

```
Collaboration / Apps     Apps · OpenSharing · Marketplace · Clean Rooms
BI / SQL                 Databricks SQL · Dashboards · Genie · AI Functions
ML / AI                  MLflow · Model Serving · AI Gateway · Feature/Model in UC
Orchestration            Lakeflow Jobs · CI/CD · Git folders
Ingest / Transform       Connect · Auto Loader · Pipelines · Structured Streaming
Governance               Unity Catalog (+ Federation, quality, lineage)
Storage                  Delta Lake / Iceberg on cloud object storage
OLTP (adjacent)          Lakebase (Postgres)
```

**Thesis restated.** Delta Lake makes the lake reliable; Unity Catalog makes it governable for data *and* AI; Lakeflow moves data in and through; Databricks SQL and Mosaic AI consume it; Lakebase and Apps extend into OLTP and product surfaces; OpenSharing extends trust across organizational boundaries — without requiring a second copy of every dataset for each persona.

### 12. Conclusion

Treating Databricks as “just Spark notebooks” understates the product. The major services form a layered platform: open storage format, unified governance, declarative and streaming data engineering, SQL warehousing, ML/AI lifecycle and serving, OLTP adjacency, and cross-org collaboration. For deeper work, the natural next cuts are Unity Catalog’s privilege model, Lakeflow pipeline mechanics, Databricks SQL/Photon behavior, and Mosaic AI serving/gateway details.

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What problem does the lakehouse pattern claim to solve relative to separate lakes and warehouses?
---
It aims to combine lake-cost, open object storage with warehouse-like reliability (transactions, schema, performance) and a single governed source of truth so ETL, BI, and ML do not each need a separate copy and catalog.
:::

:::quiz
**Q2.** How does Unity Catalog’s three-level namespace relate to managed vs external tables?
---
Data/AI assets live under `catalog.schema.object`. **Managed** tables/volumes: Unity Catalog governs access *and* storage lifecycle. **External**: Unity Catalog governs access only; storage remains where you pointed it.
:::

:::quiz
**Q3.** Name the three Lakeflow pillars and one adjacent ingest tool often used with cloud files.
---
**Connect** (enterprise connectors), **pipelines** (declarative ETL), **Jobs** (orchestration). **Auto Loader** incrementally loads files from cloud storage into the lakehouse.
:::

:::quiz
**Q4.** How do Databricks SQL and Mosaic AI Model Serving both depend on Unity Catalog?
---
SQL warehouses query UC-governed tables with fine-grained ACLs; models/features/endpoints are also UC-governed assets, with AI Gateway extending policy to generative model traffic — one governance plane for analytics and AI.
:::

:::quiz
**Q5.** What is Lakebase, and why does the platform include an OLTP product?
---
Lakebase is a managed Postgres OLTP database on Databricks. It lets transactional apps sit next to the analytical lakehouse with sync and integration to features, SQL, and Apps, instead of leaving online stores entirely outside the platform.
:::

---

## Memo

—
