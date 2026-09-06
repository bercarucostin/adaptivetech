# Caddy with the site and its config baked in.
#
# Why an image instead of two bind mounts:
#
# Coolify rewrites relative bind mounts in a compose file to paths under its
# own application directory (/data/coolify/applications/<uuid>/...), and when
# the target does not exist it creates it as a DIRECTORY. Mounting
# ./Caddyfile then fails with "not a directory: Are you trying to mount a
# directory onto a file", and ../website would silently become an empty
# directory -- Caddy would start and serve nothing.
#
# Baking both in avoids the rewrite entirely, and has a second benefit: the
# served site is whatever the deployed commit contains, so a deploy and the
# content it publishes cannot drift apart.
#
# Build context is the REPOSITORY ROOT, not deploy/, because the site lives
# outside deploy/. The compose file sets `context: ..` accordingly.

FROM caddy:2-alpine

# The site: index.html, demo/, assets/.
COPY website /srv/site

# The config. Caddy validates it at startup; a syntax error stops the
# container rather than serving a half-configured site.
COPY deploy/Caddyfile /etc/caddy/Caddyfile
