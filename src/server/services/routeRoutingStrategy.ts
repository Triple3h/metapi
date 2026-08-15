export type RouteRoutingStrategy = 'weighted' | 'round_robin' | 'stable_first' | 'key_sticky';

export const DEFAULT_ROUTE_ROUTING_STRATEGY: RouteRoutingStrategy = 'weighted';

export function normalizeRouteRoutingStrategy(value: unknown): RouteRoutingStrategy {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'round_robin') return 'round_robin';
  if (normalized === 'stable_first') return 'stable_first';
  if (normalized === 'key_sticky') return 'key_sticky';
  return DEFAULT_ROUTE_ROUTING_STRATEGY;
}

export function isRoundRobinRouteRoutingStrategy(value: unknown): boolean {
  return normalizeRouteRoutingStrategy(value) === 'round_robin';
}

export function isKeyStickyRouteRoutingStrategy(value: unknown): boolean {
  return normalizeRouteRoutingStrategy(value) === 'key_sticky';
}
