export type AdminAccountOrganizerGrant = {
  candidateId: string;
  eventId: string | null;
  name: string;
  edition: number;
  role: "owner";
  membersHref: string;
};

export type AdminAccountClaim = {
  id: string;
  eventId: string;
  eventName: string;
  circleId: string;
  circleName: string;
  status: "pending" | "verified" | "rejected" | "revoked" | "withdrawn";
  createdAt: number;
  detailHref: string | null;
  reviewHref: string | null;
};

export type AdminAccountDetail = {
  email: string;
  status: "active" | "disabled" | "deleting";
  createdAt: number;
  disabledAt: number | null;
  deletionStartedAt: number | null;
  isAdmin: boolean;
  organizerGrants: AdminAccountOrganizerGrant[];
  claims: AdminAccountClaim[];
};

export type AdminAccountDetailResponse = {
  email: string;
  account: AdminAccountDetail | null;
};

/** A claim whose circle name matched an admin's search, with the account that made it. */
export type AdminAccountCircleMatch = {
  email: string;
  circleName: string;
  eventId: string;
  eventName: string;
  status: AdminAccountClaim["status"];
};

export type AdminAccountCircleSearchResponse = {
  query: string;
  matches: AdminAccountCircleMatch[];
};
