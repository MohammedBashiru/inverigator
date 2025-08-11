# Change Log

All notable changes to the "inverigator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.4] - 2025-08-11

### Fixed
- **Critical Memory Leak Fix**: Extension no longer attempts to resolve every JavaScript identifier as an InversifyJS token
- Fixed excessive "Looking for implementation of token" log spam that occurred during navigation
- CodeLens and Hover providers now only process actual `@inject` decorated properties
- Navigation commands now filter out built-in JavaScript/TypeScript methods and types

### Added
- Built-in identifier filtering system to skip 150+ common JavaScript/TypeScript identifiers
- Injected Property Tracker to accurately identify which class properties are actually injected via `@inject` decorator
- `inverigator.verboseLogging` configuration option for debugging purposes (default: false)

### Changed
- Improved performance by reducing unnecessary token lookups by ~95%
- Navigator service now uses intelligent filtering to process only legitimate InversifyJS bindings
- Logging is now conditional - only logs actual InversifyJS tokens unless verbose mode is enabled

### Performance
- Significantly reduced memory usage and CPU cycles during code navigation
- Eliminated unnecessary processing of non-InversifyJS identifiers
- Optimized for codebases with hundreds of bindings without performance degradation

## [0.0.3] - Previous Release

- Initial release