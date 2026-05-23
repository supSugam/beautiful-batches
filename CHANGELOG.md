# Changelog

## [0.7.0](https://github.com/supSugam/beautiful-batches/compare/v0.6.0...v0.7.0) (2026-05-23)


### Features

* vendor AI engine, improve stability, and optimize taskbar grouping ([0a9db4a](https://github.com/supSugam/beautiful-batches/commit/0a9db4af1b6df4e3f9c66e6c23017355c9fecbad))

## [0.6.0](https://github.com/supSugam/beautiful-batches/compare/v0.5.0...v0.6.0) (2026-05-04)


### Features

* Add a tabbed interface to the Watermark Settings Modal, separating AI engine settings from a new tips and shortcuts section. ([38cefac](https://github.com/supSugam/beautiful-batches/commit/38cefacea2aff40a0d34f909f788e79b0e610cb8))
* add auto-scroll to selected photo in JustifiedGrid using Virtuoso reference ([458840d](https://github.com/supSugam/beautiful-batches/commit/458840d72bfed2d6a2812fdf27a5a5e37684b652))
* add caption support, network configuration for AI services, and image status indicators ([074c819](https://github.com/supSugam/beautiful-batches/commit/074c8192613509e6d1faf8291b4b3b2a6d986112))
* Enhance Bulk Apply and Export Resize sections with new options and animations ([194b9d6](https://github.com/supSugam/beautiful-batches/commit/194b9d6fbfb8a9a4b2e2005d5576cab8a993f2f0))
* Enhance SourceEditSection with reset functionality and UI improvements ([7918359](https://github.com/supSugam/beautiful-batches/commit/791835915967ce781354761133a96173d9a6927f))
* enhance watermark model status reporting, bridge readiness, and model size verification ([c28b599](https://github.com/supSugam/beautiful-batches/commit/c28b5990ef57336268b9b0aa926c07dcbc6be4b0))
* Extend CropEntry type to support source edit history tracking ([7918359](https://github.com/supSugam/beautiful-batches/commit/791835915967ce781354761133a96173d9a6927f))
* implement AI captioning error tracking, add 90s request timeout, and include excluded images toggle in folder explorer ([28dbf3e](https://github.com/supSugam/beautiful-batches/commit/28dbf3e6f7dfdcfbfaadbdf18413c93d59217b28))
* implement folder picking and clickable tokens for export path and name patterns, and adjust empty destination path handling ([d68d096](https://github.com/supSugam/beautiful-batches/commit/d68d0964e03df836f6890eb1fb210fffa580ad44))
* Introduce new UI components, enhance Inspector sections with improved interactions, and update backend image processing capabilities ([b24c854](https://github.com/supSugam/beautiful-batches/commit/b24c85410ba4939653f5b61ffd843edb517f4bdf))
* optimize image rotation for 90-degree increments and prevent clipping with dynamic canvas sizing. ([ba013ac](https://github.com/supSugam/beautiful-batches/commit/ba013ac45ef6a23ad3b12c18200b720de3aa0aff))
* Refactor padding handling in Inspector components ([3fae977](https://github.com/supSugam/beautiful-batches/commit/3fae977ebacab48c1190b71791501329978f3fbd))
* regional watermark detection, custom api for captioning, ui fixes. ([3c353aa](https://github.com/supSugam/beautiful-batches/commit/3c353aa8c68d9ba2d974ec42ae0bb53ac0b34025))
* Update WatermarkSettingsModal with hardware diagnostics and improved model management ([7918359](https://github.com/supSugam/beautiful-batches/commit/791835915967ce781354761133a96173d9a6927f))


### Bug Fixes

* Ensure proper state management in useStore for last used hardware ([7918359](https://github.com/supSugam/beautiful-batches/commit/791835915967ce781354761133a96173d9a6927f))
* robust command detection and dependency check ([39726f6](https://github.com/supSugam/beautiful-batches/commit/39726f61ccc53b7ed762a23c62f632059cafd6ed))
* Validate and normalize persisted draft data ([7918359](https://github.com/supSugam/beautiful-batches/commit/791835915967ce781354761133a96173d9a6927f))

## [0.5.0](https://github.com/supSugam/beautiful-batches/compare/v0.4.0...v0.5.0) (2026-02-24)


### Features

* add Emitter import for macOS support ([66b722e](https://github.com/supSugam/beautiful-batches/commit/66b722e7394bfec56046f414ed72d3187f9fc73e))

## [0.4.0](https://github.com/supSugam/beautiful-batches/compare/v0.3.0...v0.4.0) (2026-02-24)


### Features

* add Linux desktop template and specify category for bundle ([8dcdb4b](https://github.com/supSugam/beautiful-batches/commit/8dcdb4b8a098c02efc5e14503f6b64202e2c981f))


### Bug Fixes

* correct asset information retrieval in install script ([b624e25](https://github.com/supSugam/beautiful-batches/commit/b624e2523ac9c77cd4f3d9d57708d0d056e613c1))

## [0.3.0](https://github.com/supSugam/beautiful-batches/compare/v0.2.0...v0.3.0) (2026-02-24)


### Features

* add quick edit image loading functionality and enhance installer scripts ([ff52ff9](https://github.com/supSugam/beautiful-batches/commit/ff52ff993aaccb70aabd902689b9227c624b4fa4))
* enhance release workflow with additional platform bundles and dependencies ([363ad67](https://github.com/supSugam/beautiful-batches/commit/363ad67d33f616a7107888d885e7f91d763e5da7))

## [0.2.0](https://github.com/supSugam/beautiful-batches/compare/v0.1.0...v0.2.0) (2026-02-24)


### Features

* a justified image grid layout with dynamic image dimension loading ([3c5a2d0](https://github.com/supSugam/beautiful-batches/commit/3c5a2d0d529b44d5cb8d2623b7d08da9c3975a57))
* Add center guide lines and center crop functionality to Inspector component ([f282a50](https://github.com/supSugam/beautiful-batches/commit/f282a500464fb21b1ea82c847a4afc7c9ef197f4))
* add FolderExplorer component for improved folder navigation and management ([f645e6b](https://github.com/supSugam/beautiful-batches/commit/f645e6b5db0c12a4afe5063997317c7a7dbe59b3))
* add image rotation and flipping functionality to cards and update grid layout to respect image transformations ([de6e5ad](https://github.com/supSugam/beautiful-batches/commit/de6e5ad3f4ac76a9e0682de44538df21e27ae633))
* Add image rotation, flipping, and reset controls with updated image container styling. ([28fccc8](https://github.com/supSugam/beautiful-batches/commit/28fccc835f3b77aa1b468ef3548e8f1ec304d133))
* Add new cropping libraries and optimize image preview generation by scaling large images and reducing output quality. ([294a6a7](https://github.com/supSugam/beautiful-batches/commit/294a6a75255a101395583a2671f45c005995ac1a))
* add padding and corner radius controls to the Inspector component ([3c0783f](https://github.com/supSugam/beautiful-batches/commit/3c0783f60d7546ae17ca34b51ad0bdeac9d30a3a))
* Adjust cropper to default to full image selection, improve freeform reset behavior, and update rotate component styling. ([8513ba2](https://github.com/supSugam/beautiful-batches/commit/8513ba2110c93da8ee596ab2d39db86febaa3ead))
* enhance export plan tree visualization with file summarization, counts, and SVG structural connectors. ([db71007](https://github.com/supSugam/beautiful-batches/commit/db71007afe1253d66a6be5e3547628e3869213c8))
* enhance folder management and draft handling ([7ba3997](https://github.com/supSugam/beautiful-batches/commit/7ba3997c8e9a10cfdb6e15053876cb73543f383a))
* Enhance image editor and caption handling ([fd69b21](https://github.com/supSugam/beautiful-batches/commit/fd69b21af135da9146cf4fdd1a1336a3ce225c11))
* enhance image inspector with improved UI, navigation, custom dimensions, and advanced cropping controls. ([0564963](https://github.com/supSugam/beautiful-batches/commit/05649634ebabf37585d6ee1b607a6b61196b60de))
* enhance image metadata handling and directory scanning ([3894832](https://github.com/supSugam/beautiful-batches/commit/38948327fecf3d87568b929b16cc88be45741b50))
* Implement a resizable Inspector component with dedicated styling, image preview, and detailed manipulation controls. ([491297a](https://github.com/supSugam/beautiful-batches/commit/491297aed19c1df06b68ba493e4163ce3d00faef))
* implement F11 fullscreen toggle and enhance window capabilities ([099efd9](https://github.com/supSugam/beautiful-batches/commit/099efd913a922a3553cf606b46b5e58536640f02))
* Implement pinch-to-zoom and pan functionality with animated zoom anchor, and integrate image panning into the crop overlay. ([64370fc](https://github.com/supSugam/beautiful-batches/commit/64370fc59563473067cd3e5101557a0d31af2b35))
* Implement smart fit to clamp the crop box within rotated image boundaries and reset zoom. ([700e564](https://github.com/supSugam/beautiful-batches/commit/700e5648ed4b7342b042a08ba0b2332c0d18283b))
* Introduce an image inspector component with cropping, rotation, and flip capabilities. ([677beae](https://github.com/supSugam/beautiful-batches/commit/677beaefa81be225f47049ab47e259ede26fc714))
* Introduce and utilize `effectiveCrop` to represent the visually displayed image region, accounting for zoom and pan. ([d7e6dbd](https://github.com/supSugam/beautiful-batches/commit/d7e6dbd43f54099901a9d8ae2da0892667f7c03f))
* Introduce rotation slider component and enhance image processing with rotation and optimized resizing. ([54a8bce](https://github.com/supSugam/beautiful-batches/commit/54a8bce6be30fc3181cff66374cf728d09837395))
* Refactor Inspector component and related hooks for improved metadata handling ([79f2ba7](https://github.com/supSugam/beautiful-batches/commit/79f2ba7cccc22b08086be39cdb4d4fa8a4ef1ce9))


### Bug Fixes

* Add safety check to `syncToStore` to prevent syncing stale cropper image dimensions. ([3cd070b](https://github.com/supSugam/beautiful-batches/commit/3cd070b67c29ef62963a3e233585ae9f459c7758))
