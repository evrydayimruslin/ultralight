// Lightweight Supabase client for Worker sandbox
// Ported from api/runtime/sandbox.ts createSupabaseClient()
// Provides @supabase/supabase-js compatible API over PostgREST

export function createSupabaseClient(
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string | undefined,
  fetchFn: typeof fetch
) {
  const apiUrl = `${supabaseUrl}/rest/v1`;
  const apiKey = serviceKey || anonKey;

  const headers: Record<string, string> = {
    'apikey': anonKey,
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  function createQueryBuilder(table: string) {
    let queryParts: string[] = [];
    let selectColumns = '*';
    let bodyData: unknown = null;
    let method = 'GET';
    let singleResult = false;
    let countOption: string | null = null;
    let preferHeaders: string[] = ['return=representation'];

    const builder: Record<string, any> = {
      select: (columns = '*', options?: { count?: 'exact' | 'planned' | 'estimated' }) => {
        selectColumns = columns;
        method = 'GET';
        if (options?.count) {
          countOption = options.count;
          preferHeaders.push(`count=${options.count}`);
        }
        return builder;
      },
      insert: (data: unknown, options?: { defaultToNull?: boolean }) => {
        bodyData = data;
        method = 'POST';
        if (options?.defaultToNull === false) preferHeaders.push('missing=default');
        return builder;
      },
      update: (data: unknown) => {
        bodyData = data;
        method = 'PATCH';
        return builder;
      },
      upsert: (data: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        bodyData = data;
        method = 'POST';
        preferHeaders.push('resolution=merge-duplicates');
        if (options?.onConflict) preferHeaders.push(`on_conflict=${options.onConflict}`);
        if (options?.ignoreDuplicates) preferHeaders.push('resolution=ignore-duplicates');
        return builder;
      },
      delete: () => { method = 'DELETE'; return builder; },
      eq: (column: string, value: unknown) => { queryParts.push(`${column}=eq.${encodeURIComponent(String(value))}`); return builder; },
      neq: (column: string, value: unknown) => { queryParts.push(`${column}=neq.${encodeURIComponent(String(value))}`); return builder; },
      gt: (column: string, value: unknown) => { queryParts.push(`${column}=gt.${encodeURIComponent(String(value))}`); return builder; },
      gte: (column: string, value: unknown) => { queryParts.push(`${column}=gte.${encodeURIComponent(String(value))}`); return builder; },
      lt: (column: string, value: unknown) => { queryParts.push(`${column}=lt.${encodeURIComponent(String(value))}`); return builder; },
      lte: (column: string, value: unknown) => { queryParts.push(`${column}=lte.${encodeURIComponent(String(value))}`); return builder; },
      like: (column: string, pattern: string) => { queryParts.push(`${column}=like.${encodeURIComponent(pattern)}`); return builder; },
      ilike: (column: string, pattern: string) => { queryParts.push(`${column}=ilike.${encodeURIComponent(pattern)}`); return builder; },
      is: (column: string, value: null | boolean) => { queryParts.push(`${column}=is.${value}`); return builder; },
      in: (column: string, values: unknown[]) => { queryParts.push(`${column}=in.(${values.map(v => encodeURIComponent(String(v))).join(',')})`); return builder; },
      contains: (column: string, value: unknown) => { queryParts.push(`${column}=cs.${encodeURIComponent(JSON.stringify(value))}`); return builder; },
      containedBy: (column: string, value: unknown) => { queryParts.push(`${column}=cd.${encodeURIComponent(JSON.stringify(value))}`); return builder; },
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        const direction = options?.ascending === false ? 'desc' : 'asc';
        const nulls = options?.nullsFirst ? 'nullsfirst' : 'nullslast';
        queryParts.push(`order=${column}.${direction}.${nulls}`);
        return builder;
      },
      limit: (count: number) => { queryParts.push(`limit=${count}`); return builder; },
      range: (from: number, to: number) => {
        preferHeaders.push(`offset=${from}`);
        queryParts.push(`limit=${to - from + 1}`);
        return builder;
      },
      single: () => { singleResult = true; preferHeaders.push('return=representation'); return builder; },
      maybeSingle: () => { singleResult = true; return builder; },

      then: async (resolve: (result: { data: unknown; error: unknown; count?: number }) => void) => {
        try {
          let url = `${apiUrl}/${table}`;
          if (method === 'GET' && selectColumns !== '*') {
            queryParts.unshift(`select=${encodeURIComponent(selectColumns)}`);
          }
          if (queryParts.length > 0) url += '?' + queryParts.join('&');

          const reqHeaders: Record<string, string> = {
            ...headers,
            'Prefer': preferHeaders.join(', '),
          };
          if (singleResult && method === 'GET') {
            reqHeaders['Accept'] = 'application/vnd.pgrst.object+json';
          }

          const response = await fetchFn(url, {
            method,
            headers: reqHeaders,
            body: bodyData ? JSON.stringify(bodyData) : undefined,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            resolve({ data: null, error: errorData });
            return;
          }

          let data = await response.json().catch(() => null);

          let count: number | undefined;
          const contentRange = response.headers.get('content-range');
          if (contentRange && countOption) {
            const match = contentRange.match(/\/(\d+|\*)/);
            if (match && match[1] !== '*') count = parseInt(match[1], 10);
          }

          if (singleResult && Array.isArray(data)) data = data[0] || null;

          resolve({ data: data, error: null, count: count });
        } catch (err) {
          resolve({ data: null, error: err });
        }
      },
    };

    return builder;
  }

  function createRpcBuilder(fnName: string, params?: Record<string, unknown>) {
    return {
      then: async (resolve: (result: { data: unknown; error: unknown }) => void) => {
        try {
          const url = `${apiUrl}/rpc/${fnName}`;
          const response = await fetchFn(url, {
            method: 'POST',
            headers,
            body: params ? JSON.stringify(params) : '{}',
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            resolve({ data: null, error: errorData });
            return;
          }
          const data = await response.json().catch(() => null);
          resolve({ data: data, error: null });
        } catch (err) {
          resolve({ data: null, error: err });
        }
      },
    };
  }

  return {
    from: (table: string) => createQueryBuilder(table),
    rpc: (fnName: string, params?: Record<string, unknown>) => createRpcBuilder(fnName, params),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: Blob | ArrayBuffer) => {
          const storageUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;
          try {
            const response = await fetchFn(storageUrl, {
              method: 'POST',
              headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': file instanceof Blob ? file.type : 'application/octet-stream',
              },
              body: file,
            });
            if (!response.ok) {
              const error = await response.json().catch(() => ({ message: response.statusText }));
              return { data: null, error: error };
            }
            const data = await response.json();
            return { data: data, error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        },
        download: async (path: string) => {
          const storageUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;
          try {
            const response = await fetchFn(storageUrl, {
              headers: { 'apikey': anonKey, 'Authorization': `Bearer ${apiKey}` },
            });
            if (!response.ok) {
              const error = await response.json().catch(() => ({ message: response.statusText }));
              return { data: null, error: error };
            }
            const blob = await response.blob();
            return { data: blob, error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        },
        getPublicUrl: (path: string) => {
          return { data: { publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}` } };
        },
      }),
    },
  };
}
