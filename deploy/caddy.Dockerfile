# Caddy with both site roots and the config baked into the image.
#
# Why an image instead of bind mounts:
#
# Coolify rewrites relative bind mounts in a compose file to paths under its
# own application directory, and when the target does not exist it creates it
# as a DIRECTORY. Mounting ./Caddyfile then fails with "not a directory", and
# ../website would silently become an empty folder -- Caddy would start
# cleanly and serve nothing, with no error anywhere.
#
# Baking them in avoids the rewrite entirely, and has a second benefit: the
# served site is whatever the deployed commit contains, so a deploy and the
# content it publishes cannot drift apart.
#
# Build context is the REPOSITORY ROOT, not deploy/, because the site lives
# outside deploy/. The compose file sets `context: ..` accordingly.

FROM caddy:2-alpine

# Two roots, one per hostname. They share nothing: the landing page is
# self-contained, and the app carries its own css, js and assets.
COPY website/site /srv/site
COPY website/app  /srv/app

# Caddy validates this at startup; a syntax error stops the container rather
# than serving a half-configured site.
COPY deploy/Caddyfile /etc/caddy/Caddyfile
