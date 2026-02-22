# Coding Guidelines

## Documentation

- All functions and type definitions MUST include JSDoc comments describing their purpose, role, and any notable details
- Add explanatory comments to object and class field definitions when necessary

## Code Style

Follow the project's linting and formatting rules enforced by `pnpm check`.

## API Changes

When your changes affect the public API or usage patterns, you MUST update the following:

- `packages/readme-example/` - Test cases that verify README examples work correctly
- `README.md` - Usage examples and documentation

This ensures that:
- All public API changes are verified through executable examples
- Documentation stays in sync with actual implementation
- Breaking changes are caught early through failing example tests
