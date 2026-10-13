import { evePassword } from "../../../src/lib/eve-config.server";
import { httpBasic, withAuthChallenges } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
export default eveChannel({
  auth: [
    withAuthChallenges(
      (request) =>
        httpBasic({ username: "studio", password: evePassword() })(request),
      [{ scheme: "Basic", parameters: { realm: "eve", charset: "UTF-8" } }],
    ),
  ],
  turnPolicy: "queue",
});
