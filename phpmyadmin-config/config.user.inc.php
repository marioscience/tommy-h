<?php
// Permite que phpMyAdmin funcione dentro de un iframe (panel admin)
$cfg['AllowThirdPartyFraming'] = true;

// Indicamos a phpMyAdmin que está detrás de un proxy HTTPS
$_SERVER['HTTPS'] = 'on';

// PmaAbsoluteUri: usa la variable de entorno inyectada por Docker
// Esto hace que phpMyAdmin genere todos sus links/assets con el prefijo /pma/
if (getenv('PMA_ABSOLUTE_URI')) {
    $cfg['PmaAbsoluteUri'] = getenv('PMA_ABSOLUTE_URI');
}
?>
