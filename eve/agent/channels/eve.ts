import { httpBasic } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
export default eveChannel({
  auth: [
    httpBasic({
      username: "studio",
      password: process.env.EVE_PASSWORD || "studio-local-agent",
    }),
  ],
  turnPolicy: "queue",
});
