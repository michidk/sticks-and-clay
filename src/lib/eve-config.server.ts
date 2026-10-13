export function evePassword(
  environment: Record<string, string | undefined> = process.env,
) {
  const password = environment.EVE_PASSWORD;
  if (!password || password.length < 32)
    throw new Error(
      "Set EVE_PASSWORD to a random secret of at least 32 characters",
    );
  return password;
}
