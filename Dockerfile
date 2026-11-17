# Rectify (Firebase edition) on Airbase: a small nginx container serving the app in public/.
# Sign-in and data go straight from the browser to Firebase; emails go through the Rectify mailer.
FROM gdssingapore/airbase:nginx-1.28
COPY --chown=nginx:nginx public /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf.template
USER root
RUN printf '#!/bin/sh\nenvsubst "\\$PORT" < /etc/nginx/nginx.conf.template > /tmp/nginx.conf\nexec nginx -c /tmp/nginx.conf -g "daemon off;"\n' > /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
USER nginx
EXPOSE 3000
CMD ["/docker-entrypoint.sh"]
