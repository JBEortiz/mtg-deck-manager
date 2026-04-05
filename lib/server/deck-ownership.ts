export type OwnershipRouteError = {
  body: Record<string, unknown>;
  status: number;
};

type OwnedResource = {
  ownerUserId: number;
};

type NewDeckInput = {
  commander: string;
  createdAt: string;
  format: string;
  id: number;
  name: string;
  ownerUserId: number;
};

function springErrorBody(status: number, error: string, path: string) {
  return {
    timestamp: new Date().toISOString(),
    status,
    error,
    path
  };
}

export function unauthenticatedApiError(): OwnershipRouteError {
  return {
    status: 401,
    body: {
      message: "Debes iniciar sesion."
    }
  };
}

export function notFoundForOwnership(path: string): OwnershipRouteError {
  return {
    status: 404,
    body: springErrorBody(404, "Not Found", path)
  };
}

export function requireAuthenticatedOwner(ownerUserId?: number): number | OwnershipRouteError {
  return ownerUserId == null ? unauthenticatedApiError() : ownerUserId;
}

export function filterOwnedResources<T extends OwnedResource>(resources: T[], ownerUserId?: number) {
  return ownerUserId == null ? resources : resources.filter((resource) => resource.ownerUserId === ownerUserId);
}

export function ensureOwnedResource<T extends OwnedResource>(resource: T | null | undefined, ownerUserId: number, path: string) {
  if (!resource || resource.ownerUserId !== ownerUserId) {
    return notFoundForOwnership(path);
  }

  return resource;
}

export function createOwnedDeckRecord(input: NewDeckInput) {
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    name: input.name,
    format: input.format,
    commander: input.commander,
    createdAt: input.createdAt
  };
}
