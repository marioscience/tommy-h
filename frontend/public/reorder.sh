#!/bin/bash
FILE="index.html"
sed -n '1,625p' $FILE > p_head.html
sed -n '626,689p' $FILE > p_backend_tech.html
sed -n '1362,1458p' $FILE > p_how_it_works.html
sed -n '707,1020p' $FILE > p_games_catalog.html
sed -n '1021,1238p' $FILE > p_scripts.html
sed -n '690,706p' $FILE > p_features.html
sed -n '1239,1361p' $FILE > p_infrastructure.html
sed -n '1524,1569p' $FILE > p_comparison.html
sed -n '1459,1523p' $FILE > p_reviews.html
sed -n '1570,1610p' $FILE > p_faq.html
sed -n '1611,$p' $FILE > p_tail.html

cat p_head.html p_backend_tech.html p_how_it_works.html p_games_catalog.html p_scripts.html p_features.html p_infrastructure.html p_comparison.html p_reviews.html p_faq.html p_tail.html > index_new.html

mv index_new.html index.html
rm p_*.html
