export interface MCPToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}
export interface MCPJsonSchema {
    type?: string;
    properties?: Record<string, MCPJsonSchema>;
    items?: MCPJsonSchema;
    required?: string[];
    description?: string;
    enum?: unknown[];
    default?: unknown;
    additionalProperties?: boolean | MCPJsonSchema;
    $ref?: string;
    oneOf?: MCPJsonSchema[];
    allOf?: MCPJsonSchema[];
    nullable?: boolean;
    [key: string]: unknown;
}
export interface MCPTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: MCPJsonSchema;
    outputSchema?: MCPJsonSchema;
    annotations?: MCPToolAnnotations;
}
export interface MCPToolsListResponse {
    tools: MCPTool[];
    nextCursor?: string;
}
export interface MCPToolCallRequest {
    name: string;
    arguments: Record<string, unknown>;
}
export interface MCPResource {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
}
export interface MCPContent {
    type: 'text' | 'image' | 'audio' | 'resource' | 'resource_link';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
    resource?: MCPResource;
}
export interface MCPToolCallResponse {
    content: MCPContent[];
    structuredContent?: unknown;
    isError?: boolean;
}
export interface MCPServerInfo {
    protocolVersion: string;
    capabilities: {
        tools?: {
            listChanged?: boolean;
        };
        resources?: {
            subscribe?: boolean;
            listChanged?: boolean;
        };
    };
    serverInfo: {
        name: string;
        version: string;
    };
    instructions?: string;
}
export interface MCPResourceDescriptor {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface MCPResourceContent {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
}
