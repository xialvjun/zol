import { booleanCol, Col, colUnwrap, colWrap } from "./Column";
import { compQuery2 } from "./Compile";
import * as Debug from "./Debug";
import { QueryMetricsImpl } from "./Frontend";
import * as Frontend from "./Frontend";
import { GenState, initState } from "./GenState";
import { pg } from "./pg";
import * as m from "./Query";
import { Aggr, AggrCols, Inner, LeftCols, MakeCols } from "./Query";
import { Order } from "./SQL";
import { SqlType } from "./SqlType";
import { Table } from "./Table";

export class Q<s> {
    /* istanbul ignore next */
    private constructor() { this.dummy(); }
    /* istanbul ignore next */
    private dummy(): [Q<s>, s] { throw new Error(); }
}

// Single element (a simple box)
type MutQuery = GenState[];

export async function query<t extends object>(conn: pg.Client, q: (q: Q<any>) => MakeCols<any, t>): Promise<t[]> {
    if (Debug.enabled) {
        Debug.lastQueryMetrics.set(conn, new QueryMetricsImpl());
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage1BeforeCompileQuery();
    }
    const mutQ: MutQuery = [initState];
    const result = q(<any>mutQ);
    const [n, sql] = compQuery2(result, mutQ[0]);
    return Frontend.query2<t>(conn, n, sql);
}

export function select<s, a extends object, b extends object>(q: Q<s>, table: Table<a, b>): MakeCols<s, a & b> {
    const mutQ: MutQuery = <any>q;
    const [x, y] = m.select<s, a, b>(table).unQ.runState(mutQ[0]);
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
                return [result, mutQ2[0]];
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
                return [result, mutQ2[0]];
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
                return [result, mutQ2[0]];
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
    const mutQ: MutQuery = [initState];
    const result = rhs(<any>mutQ);
    const result2 = { val: result }; // Column name can be anything, just need to make sure there is only one

    return <any>colWrap({
        type: "EInQuery",
        exp: colUnwrap(lhs),
        sql: compQuery2(result2, mutQ[0])[1],
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
                return [result, mutQ2[0]];
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