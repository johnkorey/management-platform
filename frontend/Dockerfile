# =====================================================
# Evilginx Management Platform - Frontend
# =====================================================

FROM nginx:alpine

# Copy frontend files
COPY index.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/

# Copy nginx config template
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Default backend URL (can be overridden by environment variable)
ENV BACKEND_URL=http://backend:3000

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1
