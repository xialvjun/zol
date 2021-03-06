import { booleanCol, Col, colUnwrap, colWrap, numberCol } from "./Column";
import { compQuery2, freshScope, resetGlobalNameSupply, resetScope } from "./Compile";
import * as Debug from "./Debug";
import { QueryMetricsImpl } from "./Frontend";
import * as Frontend from "./Frontend";
import { GenState, initState } from "./GenState";
import { pg } from "./pg";
import * as m from "./Query";
import { Aggr, AggrCols, Inner, LeftCols, MakeCols } from "./Query";
import { Order } from "./SQL";
import { SqlType } from "./SqlType";
import { StreamingRows } from "./StreamingRows";
import { Table } from "./Table";
import { Unsafe } from "./Unsafe";

export class Q<s> {
    protected dummy: [Q<s>, s];
}

// Single element (a simple box)
type MutQuery = GenState[];

/**
 * @param sqlTag Will be injected as a comment into the SQL that is sent to the server. Useful for identifying the query during log analysis and performance analysis
 */
export async function query<t extends object>(sqlTag: string | undefined, conn: pg.Client, q: (q: Q<{}>) => MakeCols<{}, t>): Promise<t[]> {
    if (Debug.enabled) {
        Debug.lastQueryMetrics.set(conn, new QueryMetricsImpl());
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage1BeforeCompileQuery();
    }

    // This ensures that the generated SQL will be the same for identical queries
    resetScope();
    resetGlobalNameSupply();

    const mutQ: MutQuery = [initState(0)];
    const result = q(<any>mutQ);
    const sql = compQuery2(result, mutQ[0]);
    return Frontend.query2<t>(sqlTag, conn, sql);
}

/**
 * Perform a query, but stream the results rather than loading them all into
 * memory.
 *
 * After you call this function, you *must* call the `readAllRows` function, and
 * you must call it while the connection is still open (and don't close the
 * connection until it completes).
 *
 * @param sqlTag Will be injected as a comment into the SQL that is sent to the server. Useful for identifying the query during log analysis and performance analysis
 * @param rowChunkSize How many rows to read and process during each iteration
 */
export async function queryStreaming<t extends object>(sqlTag: string | undefined, conn: pg.Client, q: (q: Q<{}>) => MakeCols<{}, t>, rowChunkSize = 2000): Promise<StreamingRows<t>> {
    // This ensures that the generated SQL will be the same for identical queries
    resetScope();
    resetGlobalNameSupply();

    const mutQ: MutQuery = [initState(0)];
    const result = q(<any>mutQ);
    const sql = compQuery2(result, mutQ[0]);
    return Frontend.query2Streaming<t>(sqlTag, conn, sql, rowChunkSize);
}

export function select<s, a extends object, b extends object>(q: Q<s>, table: Table<a, b>): MakeCols<s, a & b> {
    const mutQ: MutQuery = <any>q;
    const [x, y] = m.select<s, a, b>(table).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

/**
 * Query an ad hoc table. Each element in the given list represents one row
 * in the ad hoc table.
 */
export function selectValues<s, a extends object>(q: Q<s>, vals: MakeCols<s, a>[]): MakeCols<s, a> {
    const mutQ: MutQuery = <any>q;
    const [x, y] = m.selectValues<s, a>(vals).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

export function restrict<s>(q: Q<s>, expr: Col<s, boolean>): void {
    const mutQ: MutQuery = <any>q;
    const [x, y] = m.restrict(expr).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

export function leftJoin<s, a extends object>(q: Q<s>, s: (q: Q<Inner<s>>) => MakeCols<Inner<s>, a>, pred: (p: MakeCols<s, a>) => Col<s, boolean>): LeftCols<s, a> {
    const mutQ: MutQuery = <any>q;
    const qr = {
        unQ: {
            runState: (x: GenState): [a, GenState] => {
                const mutQ2: MutQuery = [x];
                const result = s(<any>mutQ2);
                return [<any>result, mutQ2[0]];
            }
        }
    };
    const [x, y] = m.leftJoin(<any>qr, pred).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

export function innerJoin<s, a extends object>(q: Q<s>, s: (q: Q<Inner<s>>) => MakeCols<Inner<s>, a>, pred: (p: MakeCols<s, a>) => Col<s, boolean>): MakeCols<s, a> {
    const mutQ: MutQuery = <any>q;
    const qr = {
        unQ: {
            runState: (x: GenState): [a, GenState] => {
                const mutQ2: MutQuery = [x];
                const result = s(<any>mutQ2);
                return [<any>result, mutQ2[0]];
            }
        }
    };
    const [x, y] = m.innerJoin(<any>qr, pred).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

/**
 * Explicitly create an inner query.
 *
 * Sometimes it's handy, for performance reasons and otherwise, to perform a
 * subquery and restrict only that query before adding the result of the
 * query to the result set, instead of first adding the query to the result
 * set and restricting the whole result set afterwards.
 */
export function inner<s, a extends object>(q: Q<s>, query: (q: Q<Inner<s>>) => MakeCols<Inner<s>, a>): MakeCols<s, a> {
    return innerJoin(q, query, () => booleanCol(true));
}

/**
 * Create and filter an inner query, before adding it to the current result
 * set.
 *
 * `suchThat(q, query, p)`
 * is generally more efficient than
 * `const x = query(q); restrict(pred(x)); return x;`
 */
export function suchThat<s, a extends object>(q: Q<s>, query: (q: Q<Inner<s>>) => MakeCols<Inner<s>, a>, pred: (row: MakeCols<Inner<s>, a>) => Col<Inner<s>, boolean>): MakeCols<s, a> {
    return inner(q, q => {
        const x = query(q);
        restrict(q, pred(x));
        return x;
    });
}

export function aggregate<s, a extends object>(q: Q<s>, s: (q: Q<Inner<s>>) => AggrCols<s, a>): MakeCols<s, a> {
    const mutQ: MutQuery = <any>q;
    const qr = {
        unQ: {
            runState: (x: GenState): [a, GenState] => {
                const mutQ2: MutQuery = [x];
                const result = s(<any>mutQ2);
                return [<any>result, mutQ2[0]];
            }
        }
    };
    const [x, y] = m.aggregate(<any>qr).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return <any>x;
}

export function groupBy<s, a>(q: Q<Inner<s>>, col: Col<Inner<s>, a>): Aggr<Inner<s>, a> {
    const mutQ: MutQuery = <any>q;
    const [x, y] = m.groupBy(col).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

export function inQuery<s, a>(lhs: Col<s, a>, rhs: (q: Q<s>) => Col<s, a>): Col<s, boolean> {
    const mutQ: MutQuery = [initState(freshScope())];
    const result = rhs(<any>mutQ);
    const result2 = { val: result }; // Column name can be anything, just need to make sure there is only one

    return <any>colWrap({
        type: "EInQuery",
        exp: colUnwrap(lhs),
        sql: compQuery2(result2, mutQ[0]),
        parser: SqlType.booleanParser
    });
}

/**
 * The type of an [[arbitrary]] column
 */
export class Arbitrary {
    protected dummy: Arbitrary;
}

/**
 * An arbitrary column, useful for queries where the values of the returned
 * rows are not important, such as in [[exists]] queries.
 */
export function arbitrary<s>(): Col<s, Arbitrary> {
    return <any>Unsafe.unsafeCast(numberCol(1), "INT", SqlType.intParser);
}

/**
 * Does the subquery have at least one row?
 *
 * SQL equivalent: EXISTS
 *
 * @param subquery The subquery should return [[arbitrary]] (since the values,
 *                 of the resulting rows in unimportant).
 */
export function exists<s>(subquery: (q: Q<s>) => Col<s, Arbitrary>): Col<s, boolean> {
    const mutQ: MutQuery = [initState(freshScope())];
    const result = subquery(<any>mutQ);
    const result2 = { val: result }; // Column name can be anything, just need to make sure there is only one

    return <any>colWrap({
        type: "EExists",
        sql: compQuery2(result2, mutQ[0]),
        parser: SqlType.booleanParser
    });
}

export function limit<s, a extends object>(q: Q<s>, from: number, to: number, query: (q: Q<Inner<s>>) => MakeCols<Inner<s>, a>): MakeCols<s, a> {
    const mutQ: MutQuery = <any>q;
    const qr = {
        unQ: {
            runState: (x: GenState): [a, GenState] => {
                const mutQ2: MutQuery = [x];
                const result = query(<any>mutQ2);
                return [<any>result, mutQ2[0]];
            }
        }
    };
    const [x, y] = m.limit(from, to, <any>qr).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return <any>x;
}

export function order<s, a>(q: Q<s>, col: Col<s, a>, order: Order): void {
    const mutQ: MutQuery = <any>q;
    const [x, y] = m.order(col, order).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return x;
}

export function distinct<s, a extends object>(q: Q<s>, query: (q: Q<s>) => MakeCols<s, a>): MakeCols<s, a> {
    const mutQ: MutQuery = <any>q;
    const qr = {
        unQ: {
            runState: (x: GenState): [a, GenState] => {
                const mutQ2: MutQuery = [x];
                const result = query(<any>mutQ2);
                return [<any>result, mutQ2[0]];
            }
        }
    };
    const [x, y] = m.distinct(<any>qr).unQ.runState(mutQ[0]);
    mutQ[0] = y;
    return <any>x;
}

/**
 * Similar to [[query]], but when you are certain that the query will always return
 * exactly 1 row.
 *
 * For example: COUNT(*) style queries
 *
 * @param sqlTag Will be injected as a comment into the SQL that is sent to the server. Useful for identifying the query during log analysis and performance analysis
 */
export async function queryOne<t extends object>(sqlTag: string | undefined, conn: pg.Client, q: (q: Q<{}>) => MakeCols<{}, t>): Promise<t> {
    const rows = await query(sqlTag, conn, q);
    if (rows.length !== 1) {
        throw new Error(`Expected query to return 1 row, but got ${rows.length}`);
    }

    return rows[0];
}

/**
 * Similar to [[query]], but when you are certain that the query will always return
 * either 1 row or 0 rows.
 *
 * For example: queries that are restricted on some primary key
 *
 * @param sqlTag Will be injected as a comment into the SQL that is sent to the server. Useful for identifying the query during log analysis and performance analysis
 */
export async function queryOneOrNone<t extends object>(sqlTag: string | undefined, conn: pg.Client, q: (q: Q<{}>) => MakeCols<{}, t>): Promise<t | null> {
    const rows = await query(sqlTag, conn, q);
    if (rows.length === 0) {
        return null;
    }
    if (rows.length === 1) {
        return rows[0];
    }

    throw new Error(`Expected query to return 1 or 0 rows, but got ${rows.length}`);
}
