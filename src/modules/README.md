# Modules (DDD transition)

현재 구조는 DDD 전환 1차 단계입니다.

- `modules/auth`, `modules/drive`: 도메인 경계(바운디드 컨텍스트) 기준 모듈 엔트리
- 기존 `src/auth`, `src/drive`는 점진 이관 대상

다음 단계 권장:

1. `presentation` (controller/dto)
2. `application` (use case/service)
3. `domain` (entity/value object/domain service)
4. `infrastructure` (repository, external adapters)

기능 동작을 유지하면서 단계적으로 이동하기 위해 현재는 wrapper module로 연결합니다.
