Name:           buzzagent
Version:        0.1.19
Release:        1%{?dist}
Summary:        Visual control center for AI coding agents
License:        MIT
URL:            https://github.com/buzzagent/buzzagent
AutoReqProv:    no

%description
Open-source desktop workbench for AI coding agents with an embedded browser,
MCP support, visual diffs, model routing, per-role reasoning controls and zero
telemetry. Ships the pinned OpenCode core as a sidecar binary.

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
cp -r %{payload_dir}/. %{buildroot}/

%files
/usr/bin/buzzagent
/usr/bin/opencode
/usr/share/applications/BuzzAgent.desktop
/usr/share/icons/hicolor/32x32/apps/buzzagent.png
/usr/share/icons/hicolor/64x64/apps/buzzagent.png
/usr/share/icons/hicolor/128x128/apps/buzzagent.png
/usr/share/icons/hicolor/256x256/apps/buzzagent.png
/usr/share/icons/hicolor/512x512/apps/buzzagent.png

%post
update-desktop-database >/dev/null 2>&1 || true
xdg-mime default BuzzAgent.desktop >/dev/null 2>&1 || true
xdg-icon-resource forceupdate >/dev/null 2>&1 || true

%postun
update-desktop-database >/dev/null 2>&1 || true

%clean
rm -rf %{buildroot}
