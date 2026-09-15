<?php
// Permite que phpMyAdmin funcione dentro de un iframe (panel admin)
$cfg['AllowThirdPartyFraming'] = true;

// Respeta el protocolo original comunicado por OxideProxy. Forzar HTTPS aquí
// rompía la cookie de sesión cuando un entorno local se abría por HTTP.
$forwardedProto = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')[0]));
if ($forwardedProto === 'https') {
    $_SERVER['HTTPS'] = 'on';
} else {
    unset($_SERVER['HTTPS']);
}

// Mantén formularios y cookies en el origen que realmente abrió el usuario.
// Solo se aceptan dominios RageNodes o direcciones privadas de laboratorio para
// que un Host malicioso no pueda influir en enlaces generados por phpMyAdmin.
$forwardedHost = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '')[0]);
$hostWithoutPort = preg_replace('/:\d+$/', '', strtolower($forwardedHost));
$trustedHost = preg_match('/(^|\.)ragenodes\.(?:com|app|dev)$/', $hostWithoutPort)
    || $hostWithoutPort === 'localhost'
    || preg_match('/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}$/', $hostWithoutPort);

if ($trustedHost) {
    $scheme = $forwardedProto === 'https' ? 'https' : 'http';
    $cfg['PmaAbsoluteUri'] = $scheme . '://' . $forwardedHost . '/pma/';
} elseif (getenv('PMA_ABSOLUTE_URI')) {
    $cfg['PmaAbsoluteUri'] = getenv('PMA_ABSOLUTE_URI');
}
?>
