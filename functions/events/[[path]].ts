import { discoveryResponse } from "../_discovery";

export const onRequestGet: PagesFunction<PortalEnv> = ({ env, request }) => discoveryResponse(env, request);
export const onRequestHead = onRequestGet;
