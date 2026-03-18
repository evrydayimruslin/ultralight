// Permission hook — wraps tool execution with approval gate.
// Shows a modal for tool calls that need permission, blocks until user responds.

import { useState, useCallback, useRef } from 'react';
import {
  type PermissionLevel,
  checkPermission as checkPermissionLevel,
  buildDescription,
  getRiskLevel,
} from '../lib/permissions';
import { getAutoApproveLight } from '../lib/storage';

// ── Types ──

export interface PermissionRequest {
  /** Tool name */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Human-readable description */
  description: string;
  /** Risk level for visual styling */
  risk: 'safe' | 'moderate' | 'high';
}

export interface SpendingRequest {
  /** Human-readable description of the purchase */
  description: string;
  /** Cost in Light (✦) */
  priceLight: number;
}

export interface UsePermissionsReturn {
  /** Current permission level */
  level: PermissionLevel;
  /** Set the permission level */
  setLevel: (level: PermissionLevel) => void;
  /** Current pending permission request (null if none) */
  pendingRequest: PermissionRequest | null;
  /** Check if a tool call is allowed. Resolves with true (allow) or false (deny). */
  checkPermission: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  /** User responded to the modal — Allow */
  allow: () => void;
  /** User responded to the modal — Always Allow (for this tool type this session) */
  alwaysAllow: () => void;
  /** User responded to the modal — Deny */
  deny: () => void;
  /** Current pending spending request (null if none) */
  pendingSpending: SpendingRequest | null;
  /** Check if spending should be auto-approved or needs user confirmation */
  checkSpending: (description: string, priceLight: number) => Promise<boolean>;
  /** User approved spending */
  approveSpending: () => void;
  /** User denied spending */
  denySpending: () => void;
}

// ── Hook ──

export function usePermissions(): UsePermissionsReturn {
  const [level, setLevel] = useState<PermissionLevel>('auto_edit');
  const [pendingRequest, setPendingRequest] = useState<PermissionRequest | null>(null);

  // Session-level "always allow" set — tool names the user has approved for the session
  const alwaysAllowSet = useRef(new Set<string>());

  // Promise resolver for the current pending request
  const resolverRef = useRef<((allowed: boolean) => void) | null>(null);

  const checkPermission = useCallback(async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    // Check if this tool type was "always allowed" this session
    if (alwaysAllowSet.current.has(toolName)) {
      return true;
    }

    const decision = checkPermissionLevel(level, toolName, args);

    if (decision === 'allow') return true;
    if (decision === 'deny') return false;

    // decision === 'ask' — show modal and wait
    const request: PermissionRequest = {
      toolName,
      args,
      description: buildDescription(toolName, args),
      risk: getRiskLevel(toolName, args),
    };

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPendingRequest(request);
    });
  }, [level]);

  const allow = useCallback(() => {
    resolverRef.current?.(true);
    resolverRef.current = null;
    setPendingRequest(null);
  }, []);

  const alwaysAllow = useCallback(() => {
    if (pendingRequest) {
      alwaysAllowSet.current.add(pendingRequest.toolName);
    }
    resolverRef.current?.(true);
    resolverRef.current = null;
    setPendingRequest(null);
  }, [pendingRequest]);

  const deny = useCallback(() => {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setPendingRequest(null);
  }, []);

  // ── Spending approval ──

  const [pendingSpending, setPendingSpending] = useState<SpendingRequest | null>(null);
  const spendingResolverRef = useRef<((approved: boolean) => void) | null>(null);

  const checkSpending = useCallback(async (
    description: string,
    priceLight: number,
  ): Promise<boolean> => {
    const threshold = getAutoApproveLight();
    if (priceLight <= threshold) {
      return true; // Auto-approve below threshold
    }

    // Show spending approval modal and wait for response
    return new Promise<boolean>((resolve) => {
      spendingResolverRef.current = resolve;
      setPendingSpending({ description, priceLight });
    });
  }, []);

  const approveSpending = useCallback(() => {
    spendingResolverRef.current?.(true);
    spendingResolverRef.current = null;
    setPendingSpending(null);
  }, []);

  const denySpending = useCallback(() => {
    spendingResolverRef.current?.(false);
    spendingResolverRef.current = null;
    setPendingSpending(null);
  }, []);

  return {
    level,
    setLevel,
    pendingRequest,
    checkPermission,
    allow,
    alwaysAllow,
    deny,
    pendingSpending,
    checkSpending,
    approveSpending,
    denySpending,
  };
}
