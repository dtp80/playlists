"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  PrismaSqlite: () => PrismaSqliteAdapterFactory
});
module.exports = __toCommonJS(index_exports);

// src/sqlite.ts
var import_node_sqlite = require("node:sqlite");
var import_driver_adapter_utils2 = require("@prisma/driver-adapter-utils");

// node_modules/.pnpm/async-mutex@0.5.0/node_modules/async-mutex/index.mjs
var E_TIMEOUT = new Error("timeout while waiting for mutex to become available");
var E_ALREADY_LOCKED = new Error("mutex already locked");
var E_CANCELED = new Error("request for lock canceled");
var __awaiter$2 = function(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};
var Semaphore = class {
  constructor(_value, _cancelError = E_CANCELED) {
    this._value = _value;
    this._cancelError = _cancelError;
    this._queue = [];
    this._weightedWaiters = [];
  }
  acquire(weight = 1, priority = 0) {
    if (weight <= 0)
      throw new Error(`invalid weight ${weight}: must be positive`);
    return new Promise((resolve, reject) => {
      const task = { resolve, reject, weight, priority };
      const i = findIndexFromEnd(this._queue, (other) => priority <= other.priority);
      if (i === -1 && weight <= this._value) {
        this._dispatchItem(task);
      } else {
        this._queue.splice(i + 1, 0, task);
      }
    });
  }
  runExclusive(callback_1) {
    return __awaiter$2(this, arguments, void 0, function* (callback, weight = 1, priority = 0) {
      const [value, release] = yield this.acquire(weight, priority);
      try {
        return yield callback(value);
      } finally {
        release();
      }
    });
  }
  waitForUnlock(weight = 1, priority = 0) {
    if (weight <= 0)
      throw new Error(`invalid weight ${weight}: must be positive`);
    if (this._couldLockImmediately(weight, priority)) {
      return Promise.resolve();
    } else {
      return new Promise((resolve) => {
        if (!this._weightedWaiters[weight - 1])
          this._weightedWaiters[weight - 1] = [];
        insertSorted(this._weightedWaiters[weight - 1], { resolve, priority });
      });
    }
  }
  isLocked() {
    return this._value <= 0;
  }
  getValue() {
    return this._value;
  }
  setValue(value) {
    this._value = value;
    this._dispatchQueue();
  }
  release(weight = 1) {
    if (weight <= 0)
      throw new Error(`invalid weight ${weight}: must be positive`);
    this._value += weight;
    this._dispatchQueue();
  }
  cancel() {
    this._queue.forEach((entry) => entry.reject(this._cancelError));
    this._queue = [];
  }
  _dispatchQueue() {
    this._drainUnlockWaiters();
    while (this._queue.length > 0 && this._queue[0].weight <= this._value) {
      this._dispatchItem(this._queue.shift());
      this._drainUnlockWaiters();
    }
  }
  _dispatchItem(item) {
    const previousValue = this._value;
    this._value -= item.weight;
    item.resolve([previousValue, this._newReleaser(item.weight)]);
  }
  _newReleaser(weight) {
    let called = false;
    return () => {
      if (called)
        return;
      called = true;
      this.release(weight);
    };
  }
  _drainUnlockWaiters() {
    if (this._queue.length === 0) {
      for (let weight = this._value; weight > 0; weight--) {
        const waiters = this._weightedWaiters[weight - 1];
        if (!waiters)
          continue;
        waiters.forEach((waiter) => waiter.resolve());
        this._weightedWaiters[weight - 1] = [];
      }
    } else {
      const queuedPriority = this._queue[0].priority;
      for (let weight = this._value; weight > 0; weight--) {
        const waiters = this._weightedWaiters[weight - 1];
        if (!waiters)
          continue;
        const i = waiters.findIndex((waiter) => waiter.priority <= queuedPriority);
        (i === -1 ? waiters : waiters.splice(0, i)).forEach((waiter) => waiter.resolve());
      }
    }
  }
  _couldLockImmediately(weight, priority) {
    return (this._queue.length === 0 || this._queue[0].priority < priority) && weight <= this._value;
  }
};
function insertSorted(a, v) {
  const i = findIndexFromEnd(a, (other) => v.priority <= other.priority);
  a.splice(i + 1, 0, v);
}
function findIndexFromEnd(a, predicate) {
  for (let i = a.length - 1; i >= 0; i--) {
    if (predicate(a[i])) {
      return i;
    }
  }
  return -1;
}
var __awaiter$1 = function(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};
var Mutex = class {
  constructor(cancelError) {
    this._semaphore = new Semaphore(1, cancelError);
  }
  acquire() {
    return __awaiter$1(this, arguments, void 0, function* (priority = 0) {
      const [, releaser] = yield this._semaphore.acquire(1, priority);
      return releaser;
    });
  }
  runExclusive(callback, priority = 0) {
    return this._semaphore.runExclusive(() => callback(), 1, priority);
  }
  isLocked() {
    return this._semaphore.isLocked();
  }
  waitForUnlock(priority = 0) {
    return this._semaphore.waitForUnlock(1, priority);
  }
  release() {
    if (this._semaphore.isLocked())
      this._semaphore.release();
  }
  cancel() {
    return this._semaphore.cancel();
  }
};

// package.json
var name = "prisma-adapter-sqlite";

// src/conversion.ts
var import_driver_adapter_utils = require("@prisma/driver-adapter-utils");
var debug = (0, import_driver_adapter_utils.Debug)("prisma:driver-adapter:sqlite:conversion");
function mapDeclType(declType) {
  if (declType === null) {
    return null;
  }
  switch (declType.toUpperCase()) {
    case "":
      return null;
    case "DECIMAL":
      return import_driver_adapter_utils.ColumnTypeEnum.Numeric;
    case "FLOAT":
      return import_driver_adapter_utils.ColumnTypeEnum.Float;
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "NUMERIC":
    case "REAL":
      return import_driver_adapter_utils.ColumnTypeEnum.Double;
    case "TINYINT":
    case "SMALLINT":
    case "MEDIUMINT":
    case "INT":
    case "INTEGER":
    case "SERIAL":
    case "INT2":
      return import_driver_adapter_utils.ColumnTypeEnum.Int32;
    case "BIGINT":
    case "UNSIGNED BIG INT":
    case "INT8":
      return import_driver_adapter_utils.ColumnTypeEnum.Int64;
    case "DATETIME":
    case "TIMESTAMP":
      return import_driver_adapter_utils.ColumnTypeEnum.DateTime;
    case "TIME":
      return import_driver_adapter_utils.ColumnTypeEnum.Time;
    case "DATE":
      return import_driver_adapter_utils.ColumnTypeEnum.Date;
    case "TEXT":
    case "CLOB":
    case "CHARACTER":
    case "VARCHAR":
    case "VARYING CHARACTER":
    case "NCHAR":
    case "NATIVE CHARACTER":
    case "NVARCHAR":
      return import_driver_adapter_utils.ColumnTypeEnum.Text;
    case "BLOB":
      return import_driver_adapter_utils.ColumnTypeEnum.Bytes;
    case "BOOLEAN":
      return import_driver_adapter_utils.ColumnTypeEnum.Boolean;
    case "JSONB":
      return import_driver_adapter_utils.ColumnTypeEnum.Json;
    default:
      debug("unknown decltype:", declType);
      return null;
  }
}
function mapDeclaredColumnTypes(columnTypes) {
  const emptyIndices = /* @__PURE__ */ new Set();
  const result = columnTypes.map((typeName, index) => {
    const mappedType = mapDeclType(typeName);
    if (mappedType === null) {
      emptyIndices.add(index);
    }
    return mappedType;
  });
  return [result, emptyIndices];
}
function getColumnTypes(declaredTypes, rows) {
  const [columnTypes, emptyIndices] = mapDeclaredColumnTypes(declaredTypes);
  if (emptyIndices.size === 0) {
    return columnTypes;
  }
  columnLoop: for (const columnIndex of emptyIndices) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const candidateValue = rows[rowIndex][columnIndex];
      if (candidateValue !== null) {
        columnTypes[columnIndex] = inferColumnType(candidateValue);
        continue columnLoop;
      }
    }
    columnTypes[columnIndex] = import_driver_adapter_utils.ColumnTypeEnum.Int32;
  }
  return columnTypes;
}
function inferColumnType(value) {
  switch (typeof value) {
    case "string":
      return import_driver_adapter_utils.ColumnTypeEnum.Text;
    case "bigint":
      return import_driver_adapter_utils.ColumnTypeEnum.Int64;
    case "boolean":
      return import_driver_adapter_utils.ColumnTypeEnum.Boolean;
    case "number":
      return import_driver_adapter_utils.ColumnTypeEnum.UnknownNumber;
    case "object":
      return inferObjectType(value);
    default:
      throw new UnexpectedTypeError(value);
  }
}
function inferObjectType(value) {
  if (value instanceof ArrayBuffer) {
    return import_driver_adapter_utils.ColumnTypeEnum.Bytes;
  }
  throw new UnexpectedTypeError(value);
}
var UnexpectedTypeError = class extends Error {
  name = "UnexpectedTypeError";
  constructor(value) {
    const type = typeof value;
    const repr = type === "object" ? JSON.stringify(value) : String(value);
    super(`unexpected value of type ${type}: ${repr}`);
  }
};
function mapRow(row, columnTypes) {
  const result = [];
  for (let i = 0; i < row.length; i++) {
    const value = row[i];
    if (typeof value === "number" && (columnTypes[i] === import_driver_adapter_utils.ColumnTypeEnum.Int32 || columnTypes[i] === import_driver_adapter_utils.ColumnTypeEnum.Int64) && !Number.isInteger(value)) {
      result[i] = Math.trunc(value);
      continue;
    }
    if (["number", "bigint"].includes(typeof value) && columnTypes[i] === import_driver_adapter_utils.ColumnTypeEnum.DateTime) {
      result[i] = new Date(Number(value)).toISOString();
      continue;
    }
    if (typeof value === "bigint") {
      const asNumber = Number(value);
      result[i] = Number.isSafeInteger(asNumber) ? asNumber : value.toString();
      continue;
    }
    result[i] = value;
  }
  return result;
}
function mapArg(arg, argType, options) {
  if (arg === null) {
    return null;
  }
  if (typeof arg === "string" && argType.scalarType === "int") {
    return Number.parseInt(arg);
  }
  if (typeof arg === "string" && argType.scalarType === "float") {
    return Number.parseFloat(arg);
  }
  if (typeof arg === "string" && argType.scalarType === "decimal") {
    return Number.parseFloat(arg);
  }
  if (typeof arg === "string" && argType.scalarType === "bigint") {
    return BigInt(arg);
  }
  if (typeof arg === "boolean") {
    return arg ? 1 : 0;
  }
  if (typeof arg === "string" && argType.scalarType === "datetime") {
    arg = new Date(arg);
  }
  if (arg instanceof Date) {
    const format = options?.timestampFormat ?? "iso8601";
    switch (format) {
      case "unixepoch-ms":
        return arg.getTime();
      case "iso8601":
        return arg.toISOString().replace("Z", "+00:00");
      default:
        throw new Error(`Unknown timestamp format: ${format}`);
    }
  }
  if (typeof arg === "string" && argType.scalarType === "bytes") {
    return Buffer.from(arg, "base64");
  }
  return arg;
}

// src/errors.ts
function convertDriverError(error) {
  if (isDriverError(error)) {
    return {
      originalCode: SQLITE_ERRORS[error.errcode],
      originalMessage: error.message,
      ...mapDriverError(error)
    };
  }
  throw error;
}
var SQLITE_ERRORS = {
  1: "SQLITE_ERROR",
  2: "SQLITE_INTERNAL",
  3: "SQLITE_PERM",
  4: "SQLITE_ABORT",
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  7: "SQLITE_NOMEM",
  8: "SQLITE_READONLY",
  9: "SQLITE_INTERRUPT",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  12: "SQLITE_NOTFOUND",
  13: "SQLITE_FULL",
  14: "SQLITE_CANTOPEN",
  15: "SQLITE_PROTOCOL",
  16: "SQLITE_EMPTY",
  17: "SQLITE_SCHEMA",
  18: "SQLITE_TOOBIG",
  19: "SQLITE_CONSTRAINT",
  20: "SQLITE_MISMATCH",
  21: "SQLITE_MISUSE",
  22: "SQLITE_NOLFS",
  23: "SQLITE_AUTH",
  24: "SQLITE_FORMAT",
  25: "SQLITE_RANGE",
  26: "SQLITE_NOTADB",
  27: "SQLITE_NOTICE",
  28: "SQLITE_WARNING",
  100: "SQLITE_ROW",
  101: "SQLITE_DONE",
  // SQLITE_ERROR
  257: "SQLITE_ERROR_MISSING_COLLSEQ",
  513: "SQLITE_ERROR_RETRY",
  769: "SQLITE_ERROR_SNAPSHOT",
  1025: "SQLITE_ERROR_RESERVESIZE",
  1281: "SQLITE_ERROR_KEY",
  1537: "SQLITE_ERROR_UNABLE",
  // SQLITE_IOERR
  266: "SQLITE_IOERR_READ",
  522: "SQLITE_IOERR_SHORT_READ",
  778: "SQLITE_IOERR_WRITE",
  1034: "SQLITE_IOERR_FSYNC",
  1290: "SQLITE_IOERR_DIR_FSYNC",
  1546: "SQLITE_IOERR_TRUNCATE",
  1802: "SQLITE_IOERR_FSTAT",
  2058: "SQLITE_IOERR_UNLOCK",
  2314: "SQLITE_IOERR_RDLOCK",
  2570: "SQLITE_IOERR_DELETE",
  2826: "SQLITE_IOERR_BLOCKED",
  3082: "SQLITE_IOERR_NOMEM",
  3338: "SQLITE_IOERR_ACCESS",
  3594: "SQLITE_IOERR_CHECKRESERVEDLOCK",
  3850: "SQLITE_IOERR_LOCK",
  4106: "SQLITE_IOERR_CLOSE",
  4362: "SQLITE_IOERR_DIR_CLOSE",
  4618: "SQLITE_IOERR_SHMOPEN",
  4874: "SQLITE_IOERR_SHMSIZE",
  5130: "SQLITE_IOERR_SHMLOCK",
  5386: "SQLITE_IOERR_SHMMAP",
  5642: "SQLITE_IOERR_SEEK",
  5898: "SQLITE_IOERR_DELETE_NOENT",
  6154: "SQLITE_IOERR_MMAP",
  6410: "SQLITE_IOERR_GETTEMPPATH",
  6666: "SQLITE_IOERR_CONVPATH",
  6922: "SQLITE_IOERR_VNODE",
  7178: "SQLITE_IOERR_AUTH",
  7434: "SQLITE_IOERR_BEGIN_ATOMIC",
  7690: "SQLITE_IOERR_COMMIT_ATOMIC",
  7946: "SQLITE_IOERR_ROLLBACK_ATOMIC",
  8202: "SQLITE_IOERR_DATA",
  8458: "SQLITE_IOERR_CORRUPTFS",
  8714: "SQLITE_IOERR_IN_PAGE",
  8970: "SQLITE_IOERR_BADKEY",
  9226: "SQLITE_IOERR_CODEC",
  // SQLITE_LOCKED
  262: "SQLITE_LOCKED_SHAREDCACHE",
  518: "SQLITE_LOCKED_VTAB",
  // SQLITE_BUSY
  261: "SQLITE_BUSY_RECOVERY",
  517: "SQLITE_BUSY_SNAPSHOT",
  773: "SQLITE_BUSY_TIMEOUT",
  // SQLITE_CANTOPEN
  270: "SQLITE_CANTOPEN_NOTEMPDIR",
  526: "SQLITE_CANTOPEN_ISDIR",
  782: "SQLITE_CANTOPEN_FULLPATH",
  1038: "SQLITE_CANTOPEN_CONVPATH",
  1294: "SQLITE_CANTOPEN_DIRTYWAL",
  1550: "SQLITE_CANTOPEN_SYMLINK",
  // SQLITE_CORRUPT
  267: "SQLITE_CORRUPT_VTAB",
  523: "SQLITE_CORRUPT_SEQUENCE",
  779: "SQLITE_CORRUPT_INDEX",
  // SQLITE_READONLY
  264: "SQLITE_READONLY_RECOVERY",
  520: "SQLITE_READONLY_CANTLOCK",
  776: "SQLITE_READONLY_ROLLBACK",
  1032: "SQLITE_READONLY_DBMOVED",
  1288: "SQLITE_READONLY_CANTINIT",
  1544: "SQLITE_READONLY_DIRECTORY",
  // SQLITE_ABORT
  516: "SQLITE_ABORT_ROLLBACK",
  // SQLITE_CONSTRAINT
  275: "SQLITE_CONSTRAINT_CHECK",
  531: "SQLITE_CONSTRAINT_COMMITHOOK",
  787: "SQLITE_CONSTRAINT_FOREIGNKEY",
  1043: "SQLITE_CONSTRAINT_FUNCTION",
  1299: "SQLITE_CONSTRAINT_NOTNULL",
  1555: "SQLITE_CONSTRAINT_PRIMARYKEY",
  1811: "SQLITE_CONSTRAINT_TRIGGER",
  2067: "SQLITE_CONSTRAINT_UNIQUE",
  2323: "SQLITE_CONSTRAINT_VTAB",
  2579: "SQLITE_CONSTRAINT_ROWID",
  2835: "SQLITE_CONSTRAINT_PINNED",
  3091: "SQLITE_CONSTRAINT_DATATYPE",
  // SQLITE_NOTICE
  283: "SQLITE_NOTICE_RECOVER_WAL",
  539: "SQLITE_NOTICE_RECOVER_ROLLBACK",
  795: "SQLITE_NOTICE_RBU",
  // SQLITE_WARNING
  284: "SQLITE_WARNING_AUTOINDEX",
  // SQLITE_AUTH
  279: "SQLITE_AUTH_USER"
};
function mapDriverError(error) {
  switch (error.errcode) {
    case 5:
      return {
        kind: "SocketTimeout"
      };
    case 2067:
    case 1555: {
      const fields = error.message.split("constraint failed: ").at(1)?.split(", ").map((field) => field.split(".").pop());
      return {
        kind: "UniqueConstraintViolation",
        constraint: fields !== void 0 ? { fields } : void 0
      };
    }
    case 1299: {
      const fields = error.message.split("constraint failed: ").at(1)?.split(", ").map((field) => field.split(".").pop());
      return {
        kind: "NullConstraintViolation",
        constraint: fields !== void 0 ? { fields } : void 0
      };
    }
    case 787:
    case 1811:
      return {
        kind: "ForeignKeyConstraintViolation",
        constraint: { foreignKey: {} }
      };
    case 1:
      if (error.message.startsWith("no such table")) {
        return {
          kind: "TableDoesNotExist",
          table: error.message.split(": ").at(1)
        };
      } else if (error.message.startsWith("no such column")) {
        return {
          kind: "ColumnNotFound",
          column: error.message.split(": ").at(1)
        };
      } else if (error.message.includes("has no column named ")) {
        return {
          kind: "ColumnNotFound",
          column: error.message.split("has no column named ").at(1)
        };
      }
  }
  return {
    kind: "sqlite",
    extendedCode: error.errcode,
    message: error.message
  };
}
function isDriverError(error) {
  return error.code === "ERR_SQLITE_ERROR";
}

// src/sqlite.ts
var debug2 = (0, import_driver_adapter_utils2.Debug)("prisma:driver-adapter:sqlite");
var SqliteQueryable = class {
  constructor(client, adapterOptions) {
    this.client = client;
    this.adapterOptions = adapterOptions;
  }
  provider = "sqlite";
  adapterName = name;
  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query) {
    const tag = "[js::queryRaw]";
    debug2(`${tag} %O`, query);
    const { columnNames, declaredTypes, rows } = await this.performIO(query);
    const columnTypes = getColumnTypes(declaredTypes, rows);
    return {
      columnNames,
      columnTypes,
      rows: rows.map((row) => mapRow(row, columnTypes))
    };
  }
  /**
   * Execute a query given as SQL, interpolating the given parameters and
   * returning the number of affected rows.
   * Note: Queryable expects a u64, but napi.rs only supports u32.
   */
  async executeRaw(query) {
    const tag = "[js::executeRaw]";
    debug2(`${tag} %O`, query);
    return (await this.executeIO(query)).changes;
  }
  /**
   * Execute a query against the database, returning the result meta.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  executeIO(query) {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions));
      const stmt = this.client.prepare(query.sql);
      stmt.setReadBigInts(false);
      const result = stmt.run(...args);
      return Promise.resolve(result);
    } catch (e) {
      this.onError(e);
    }
  }
  /**
   * Run a query against the database, returning the result set.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  performIO(query) {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions));
      const stmt = this.client.prepare(query.sql);
      const columns = stmt.columns();
      if (columns.length === 0) {
        stmt.run(...args);
        return Promise.resolve({
          columnNames: [],
          declaredTypes: [],
          rows: []
        });
      }
      const resultSet = {
        declaredTypes: columns.map((column) => column.type),
        columnNames: columns.map((column) => column.name),
        // @ts-expect-error: @types/node doesn't reflect returnArrays possibility
        rows: stmt.all(...args)
      };
      return Promise.resolve(resultSet);
    } catch (e) {
      this.onError(e);
    }
  }
  onError(error) {
    debug2("Error in IO: %O", error);
    throw new import_driver_adapter_utils2.DriverAdapterError(convertDriverError(error));
  }
};
var SqliteTransaction = class extends SqliteQueryable {
  constructor(client, options, adapterOptions, unlockParent) {
    super(client, adapterOptions);
    this.options = options;
    this.#unlockParent = unlockParent;
  }
  #unlockParent;
  commit() {
    debug2(`[js::commit]`);
    this.#unlockParent();
    return Promise.resolve();
  }
  rollback() {
    debug2(`[js::rollback]`);
    this.#unlockParent();
    return Promise.resolve();
  }
  async createSavepoint(name2) {
    await this.executeRaw({ sql: `SAVEPOINT ${name2}`, args: [], argTypes: [] });
  }
  async rollbackToSavepoint(name2) {
    await this.executeRaw({ sql: `ROLLBACK TO ${name2}`, args: [], argTypes: [] });
  }
  async releaseSavepoint(name2) {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name2}`, args: [], argTypes: [] });
  }
};
var PrismaSqliteAdapter = class extends SqliteQueryable {
  #mutex = new Mutex();
  constructor(client, adapterOptions) {
    super(client, adapterOptions);
  }
  executeScript(script) {
    try {
      this.client.exec(script);
    } catch (e) {
      this.onError(e);
    }
    return Promise.resolve();
  }
  async startTransaction(isolationLevel) {
    if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
      throw new import_driver_adapter_utils2.DriverAdapterError({
        kind: "InvalidIsolationLevel",
        level: isolationLevel
      });
    }
    const options = {
      usePhantomQuery: false
    };
    const tag = "[js::startTransaction]";
    debug2("%s options: %O", tag, options);
    try {
      const release = await this.#mutex.acquire();
      this.client.prepare("BEGIN").run();
      return new SqliteTransaction(this.client, options, this.adapterOptions, release);
    } catch (e) {
      this.onError(e);
    }
  }
  dispose() {
    this.client.close();
    return Promise.resolve();
  }
};
var PrismaSqliteAdapterFactory = class {
  provider = "sqlite";
  adapterName = name;
  #config;
  #options;
  constructor(config, options) {
    this.#config = config;
    this.#options = options;
    const majorNodeVersion = parseInt(process?.versions?.node, 10);
    // Synology Package Center often ships Node 22.x; node:sqlite works there with
    // --experimental-sqlite (see ecosystem.config.cjs), same as EPG Handler.
    if (isNaN(majorNodeVersion) || majorNodeVersion < 22) {
      throw new Error(
        "playlists SQLite adapter requires Node.js v22.5+ (use --experimental-sqlite on 22.x)"
      );
    }
  }
  connect() {
    return Promise.resolve(new PrismaSqliteAdapter(createSqliteClient(this.#config), this.#options));
  }
  connectToShadowDb() {
    const url = this.#options?.shadowDatabaseUrl ?? ":memory:";
    return Promise.resolve(
      new PrismaSqliteAdapter(createSqliteClient({ ...this.#config, url }), this.#options)
    );
  }
};
function sqliteUrlToPath(url) {
  if (!url || url === ":memory:") return url || ":memory:";
  // file:///abs/path → /abs/path (NOT ///abs/path — that can open a different empty DB)
  if (url.startsWith("file:")) {
    try {
      const u = new URL(url.startsWith("file://") ? url : url.replace(/^file:/, "file://"));
      let p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // Windows
      return p;
    } catch {
      return url.replace(/^file:/, "");
    }
  }
  return url;
}
function createSqliteClient(input) {
  const { url, ...config } = input;
  const dbPath = sqliteUrlToPath(url);
  const db = new import_node_sqlite.DatabaseSync(dbPath, {
    ...config,
    readBigInts: true,
    returnArrays: true
  });
  return db;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PrismaSqlite
});
