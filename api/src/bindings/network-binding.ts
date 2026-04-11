// RPC Network Binding for Dynamic Workers
// Exposes TCP/TLS socket connections to Dynamic Workers via the parent Worker's
// native connect() API. The Dynamic Worker calls env.NET.connectTls(host, port)
// and receives a Socket with readable/writable streams.
//
// Security: blocks localhost, private networks, port 25.

import { WorkerEntrypoint } from 'cloudflare:workers';

interface NetworkBindingProps {
  userId: string;
  appId: string;
}

const MAX_CONNECTIONS = 5;
let activeConnections = 0;

export class NetworkBinding extends WorkerEntrypoint<unknown, NetworkBindingProps> {

  private validateTarget(hostname: string, port: number) {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('172.')) {
      throw new Error('Connections to internal/private networks are not allowed');
    }
    if (port === 25) {
      throw new Error('Port 25 (SMTP) is blocked. Use port 465 (SMTPS) or 587 (submission).');
    }
    if (activeConnections >= MAX_CONNECTIONS) {
      throw new Error(`Max concurrent connections exceeded (${MAX_CONNECTIONS})`);
    }
  }

  async connectTls(hostname: string, port: number) {
    this.validateTarget(hostname, port);
    activeConnections++;
    try {
      // @ts-ignore — connect() is a Cloudflare Workers global
      const socket = connect({ hostname, port }, { secureTransport: 'on' });
      return socket;
    } catch (e) {
      activeConnections--;
      throw e;
    }
  }

  async connectPlain(hostname: string, port: number) {
    this.validateTarget(hostname, port);
    activeConnections++;
    try {
      // @ts-ignore
      const socket = connect({ hostname, port }, { secureTransport: 'off' });
      return socket;
    } catch (e) {
      activeConnections--;
      throw e;
    }
  }

  async connectStartTls(hostname: string, port: number) {
    this.validateTarget(hostname, port);
    activeConnections++;
    try {
      // @ts-ignore
      const socket = connect({ hostname, port }, { secureTransport: 'starttls' });
      return socket;
    } catch (e) {
      activeConnections--;
      throw e;
    }
  }
}
