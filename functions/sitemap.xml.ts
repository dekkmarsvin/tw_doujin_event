import { sitemapResponse } from "./_discovery";

export const onRequestGet: PagesFunction<PortalEnv> = ({ env, request }) => sitemapResponse(env, request);
