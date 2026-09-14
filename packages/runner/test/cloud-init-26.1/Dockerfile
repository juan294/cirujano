FROM python:3.12-slim-bookworm

ARG CLOUD_INIT_COMMIT=8bf3567532b07e2cc15aa4c76c36ebed65ccfaec

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git \
    && git clone --filter=blob:none https://github.com/canonical/cloud-init.git /opt/cloud-init \
    && git -C /opt/cloud-init checkout --detach "${CLOUD_INIT_COMMIT}" \
    && printf '%s\n' 'UPSTREAM_VERSION = "26.1"' 'DOWNSTREAM_VERSION = "@DOWNSTREAM_VERSION@"' > /opt/cloud-init/cloudinit/meson_versions.py
RUN pip install --no-cache-dir -r /opt/cloud-init/requirements.txt
RUN apt-get purge --yes --auto-remove git \
    && rm -rf /var/lib/apt/lists/* /root/.cache /opt/cloud-init/.git

ENV PYTHONPATH=/opt/cloud-init
ENTRYPOINT ["python3", "/opt/cloud-init/cloudinit/cmd/main.py"]
