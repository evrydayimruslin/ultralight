export type JsonRpcRequestId = string | number | undefined;
export type JsonRpcResponseId = string | number | null;
export type JsonRpcId = JsonRpcRequestId | JsonRpcResponseId;
export interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}
export interface JsonRpcRequest<TParams = Record<string, unknown>> {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: TParams;
}
export interface JsonRpcResponse<TResult = unknown> {
    jsonrpc: '2.0';
    id: JsonRpcResponseId;
    result?: TResult;
    error?: JsonRpcErrorObject;
}
export declare function normalizeJsonRpcResponseId(id: JsonRpcId): JsonRpcResponseId;
