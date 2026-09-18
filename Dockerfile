FROM nginx:1.30.4-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css script.js visuals.js story-data.js narration-data.js favicon.svg /usr/share/nginx/html/
COPY audio/*.mp3 /usr/share/nginx/html/audio/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
USER nginx
