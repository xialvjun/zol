import { assertNever } from "./assertNever";
import { compQuery } from "./Compile";
import { runCustomQuery } from "./CustomQuery";
import * as Debug from "./Debug";
import { pg } from "./pg";
import { MakeCols } from "./Query";
import { Query } from "./Query/Type";
import { SQL } from "./SQL";
import { compSql } from "./SQL/Print";
import { Lit } from "./SqlType";

export class QueryMetricsImpl extends Debug.Debug.QueryMetrics {
    public setQuerySQL(val: string) {
        this.querySQL_ = val;
    }

    public setStage1BeforeCompileQuery() {
        this.stage1BeforeCompileQuery = process.hrtime();
    }

    public setStage2BeforeCompileSql() {
        this.stage2BeforeCompileSql = process.hrtime();
    }

    public setStage3BeforeRunQuery() {
        this.stage3BeforeRunQuery = process.hrtime();
    }

    public setStage4BeforeParseQueryResults() {
        this.stage4BeforeParseQueryResults = process.hrtime();
    }

    public setStage5End() {
        this.stage5End = process.hrtime();
    }
}

export function query<t extends object>(conn: pg.Client, q: Query<any, MakeCols<any, t>>): Promise<t[]> {
    if (Debug.enabled) {
        Debug.lastQueryMetrics.set(conn, new QueryMetricsImpl());
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage1BeforeCompileQuery();
    }
    const [n, sql] = compQuery(q);
    return query2(conn, n, sql);
}

export async function query2<t extends object>(conn: pg.Client, _n: number, sql: SQL): Promise<t[]> {
    if (Debug.enabled) {
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage2BeforeCompileSql();
    }
    const [, sqlText, params] = compSql(sql);
    if (Debug.enabled) {
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setQuerySQL(sqlText);
    }

    const pgParams = params.map(x => litToPgParam(x.param));
    if (Debug.enabled) {
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage3BeforeRunQuery();
    }
    const rows = await runCustomQuery(conn, sql.cols.map((s: any) => s.propName), sql.cols.map((s: any) => s.parser), sqlText, pgParams);
    if (Debug.enabled) {
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage4BeforeParseQueryResults();
    }

    if (Debug.enabled) {
        // tslint:disable-next-line:no-non-null-assertion
        (<QueryMetricsImpl>Debug.lastQueryMetrics.get(conn)!).setStage5End();
    }
    return rows;
}

export function litToPgParam(lit: Lit): any {
    switch (lit.type) {
        case "LText":
            return lit.value;
        case "LInt":
            return lit.value;
        case "LDouble":
            return lit.value;
        case "LBool":
            return lit.value;
        case "LDateTime":
            return lit.value;
        case "LDate":
            throw new Error("TODO");
        case "LTime":
            throw new Error("TODO");
        case "LNull":
            return null;
        /* istanbul ignore next */
        default:
            return assertNever(lit);
    }
}