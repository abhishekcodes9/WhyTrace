import neo4j, { type Driver, type ManagedTransaction, type QueryResult, type Record as Neo4jRecord } from "neo4j-driver";
import { isNeo4jConfigured, serverEnv } from "./env";

export class Neo4jNotConfiguredError extends Error {
  code = "NEO4J_NOT_CONFIGURED";
  constructor() {
    super(
      "Neo4j is not configured. Set NEO4J_URI, NEO4J_USERNAME and NEO4J_PASSWORD in .env.local, then restart the server.",
    );
    this.name = "Neo4jNotConfiguredError";
  }
}

export class Neo4jUnavailableError extends Error {
  code = "NEO4J_UNAVAILABLE";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "Neo4jUnavailableError";
  }
}

declare global {
  var __whytraceNeo4jDriver: Driver | undefined;
  var __whytraceSchemaReady: Promise<void> | undefined;
}

export function getDriver(): Driver {
  if (!isNeo4jConfigured()) throw new Neo4jNotConfiguredError();
  if (!globalThis.__whytraceNeo4jDriver) {
    try {
      globalThis.__whytraceNeo4jDriver = neo4j.driver(
        serverEnv.neo4jUri,
        neo4j.auth.basic(serverEnv.neo4jUsername, serverEnv.neo4jPassword),
        {
          maxConnectionPoolSize: 20,
          connectionAcquisitionTimeout: 20_000,
          connectionTimeout: 20_000,
          maxTransactionRetryTime: 15_000,
          userAgent: "whytrace/1.0",
          // Aura connections must use neo4j+s://. The driver verifies TLS.
        },
      );
    } catch (error) {
      throw new Neo4jUnavailableError("Could not initialise the Neo4j driver. Check NEO4J_URI.", { cause: error });
    }
  }
  return globalThis.__whytraceNeo4jDriver;
}

export function sessionOptions() {
  return { database: serverEnv.neo4jDatabase };
}

export async function verifyNeo4j(): Promise<{ connected: boolean; message: string; latencyMs: number }> {
  if (!isNeo4jConfigured()) {
    return { connected: false, message: "Not configured", latencyMs: 0 };
  }
  const started = Date.now();
  let session;
  try {
    session = getDriver().session(sessionOptions());
    const result = await session.run("RETURN 1 AS ok");
    const ok = result.records[0]?.get("ok")?.toNumber?.() === 1 || result.records[0]?.get("ok") === 1;
    return {
      connected: ok,
      message: ok ? `Connected to Neo4j database "${serverEnv.neo4jDatabase}"` : "Unexpected verification response",
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      connected: false,
      message: error instanceof Error ? error.message : "Neo4j connection failed",
      latencyMs: Date.now() - started,
    };
  } finally {
    await session?.close().catch(() => undefined);
  }
}

async function execute<T>(
  mode: "read" | "write",
  work: (tx: ManagedTransaction) => Promise<T>,
): Promise<T> {
  const session = getDriver().session(sessionOptions());
  try {
    const fn = mode === "read" ? session.executeRead.bind(session) : session.executeWrite.bind(session);
    return await fn(work);
  } catch (error) {
    if (error instanceof Neo4jNotConfiguredError) throw error;
    throw new Neo4jUnavailableError(
      error instanceof Error ? `Neo4j query failed: ${error.message}` : "Neo4j query failed",
      { cause: error },
    );
  } finally {
    await session.close().catch(() => undefined);
  }
}

function recordsToObjects(result: QueryResult): Record<string, unknown>[] {
  return result.records.map((record: Neo4jRecord) => record.toObject());
}

export async function readQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const result = await execute("read", (tx) => tx.run(cypher, params));
  return recordsToObjects(result) as T[];
}

export async function writeQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const result = await execute("write", (tx) => tx.run(cypher, params));
  return recordsToObjects(result) as T[];
}

export async function writeTransaction<T>(
  work: (tx: ManagedTransaction) => Promise<T>,
): Promise<T> {
  return execute("write", work);
}

export async function readTransaction<T>(
  work: (tx: ManagedTransaction) => Promise<T>,
): Promise<T> {
  return execute("read", work);
}

/**
 * Idempotent schema creation. Every node carries a globally unique canonical id
 * plus a repositoryId so records from different repositories can never mix.
 */
const CONSTRAINTS = [
  "CREATE CONSTRAINT repository_id IF NOT EXISTS FOR (n:Repository) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT file_id IF NOT EXISTS FOR (n:File) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT commit_id IF NOT EXISTS FOR (n:Commit) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT pull_id IF NOT EXISTS FOR (n:PullRequest) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT issue_id IF NOT EXISTS FOR (n:Issue) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT discussion_id IF NOT EXISTS FOR (n:Discussion) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT developer_id IF NOT EXISTS FOR (n:Developer) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (n:Decision) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (n:DesignDocument) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT incident_id IF NOT EXISTS FOR (n:Incident) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT investigation_id IF NOT EXISTS FOR (n:Investigation) REQUIRE n.id IS UNIQUE",
];

const INDEXES = [
  "CREATE INDEX repository_fullname IF NOT EXISTS FOR (n:Repository) ON (n.fullName)",
  "CREATE INDEX file_repo IF NOT EXISTS FOR (n:File) ON (n.repositoryId)",
  "CREATE INDEX commit_repo IF NOT EXISTS FOR (n:Commit) ON (n.repositoryId)",
  "CREATE INDEX pull_repo IF NOT EXISTS FOR (n:PullRequest) ON (n.repositoryId)",
  "CREATE INDEX issue_repo IF NOT EXISTS FOR (n:Issue) ON (n.repositoryId)",
  "CREATE INDEX discussion_repo IF NOT EXISTS FOR (n:Discussion) ON (n.repositoryId)",
  "CREATE INDEX decision_repo IF NOT EXISTS FOR (n:Decision) ON (n.repositoryId)",
  "CREATE INDEX doc_repo IF NOT EXISTS FOR (n:DesignDocument) ON (n.repositoryId)",
  "CREATE INDEX incident_repo IF NOT EXISTS FOR (n:Incident) ON (n.repositoryId)",
  "CREATE INDEX investigation_repo IF NOT EXISTS FOR (n:Investigation) ON (n.repositoryId)",
  "CREATE INDEX investigation_session IF NOT EXISTS FOR (n:Investigation) ON (n.sessionId)",
  "CREATE INDEX investigation_created IF NOT EXISTS FOR (n:Investigation) ON (n.createdAt)",
  `CREATE FULLTEXT INDEX entitySearch IF NOT EXISTS
   FOR (n:Commit|PullRequest|Issue|Discussion|DesignDocument|Decision|File)
   ON EACH [n.title, n.body, n.message, n.path, n.rationale, n.excerpt]`,
];

export async function ensureSchema(): Promise<void> {
  if (!isNeo4jConfigured()) throw new Neo4jNotConfiguredError();
  if (!globalThis.__whytraceSchemaReady) {
    globalThis.__whytraceSchemaReady = (async () => {
      await writeTransaction(async (tx) => {
        for (const statement of CONSTRAINTS) {
          await tx.run(statement);
        }
        for (const statement of INDEXES) {
          await tx.run(statement);
        }
      });
    })().catch((error) => {
      // Allow a later call (after transient network failure) to retry schema setup.
      globalThis.__whytraceSchemaReady = undefined;
      throw error;
    });
  }
  return globalThis.__whytraceSchemaReady;
}

export async function closeDriver(): Promise<void> {
  if (globalThis.__whytraceNeo4jDriver) {
    await globalThis.__whytraceNeo4jDriver.close();
    globalThis.__whytraceNeo4jDriver = undefined;
    globalThis.__whytraceSchemaReady = undefined;
  }
}
