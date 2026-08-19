# ADR-002: Refactorización a Patrón Factory y POO (BaseGameService)

## Estado
Aceptado

## Contexto
Originalmente, cada juego implementaba funciones procedimentales independientes (`createFivemContainer`, `createRustContainer`, `createMinecraftContainer`), lo que resultaba en código duplicado para manejo de permisos (`chown 1000:1000`), cuotas de CPU/RAM de Docker y seguridad.

## Decisión
Implementar una jerarquía orientada a objetos:
1. **`BaseGameService`**: Clase base abstracta con el patrón *Template Method*.
2. **`GameFactory`**: Patrón de diseño *Factory* centralizado para registro y resolución polimórfica de juegos.
3. Subclases especializadas (`FiveMService`, `RustGameService`, `MinecraftService`) que sobrescriben únicamente los puertos, variables de entorno y lógica específica de cada juego.

## Consecuencias
### Positivas:
- Reducción drástica de código duplicado.
- Facilidad para incorporar nuevos juegos en cuestión de minutos.
- Facilita el testing unitario y aislamiento de componentes.
- 100% de compatibilidad hacia atrás mediante exportaciones puente.
