# ScraperJS #

Web scraping bookmarklet.

## Bookmarklet code ##

```
javascript:(function(){document.open();document.write('<!doctype%20html><html><head><script%20type="text/javascript"%20src="http://phlip365.github.com/ScraperJS/min-scraper.js"></script></head><body></body></html>');document.close();})()
```
 
## Compiling and Minifying ##

Use [Google Closure Compiler](http://closure-compiler.appspot.com/home):

	// ==ClosureCompiler==
	// @compilation_level ADVANCED_OPTIMIZATIONS
	// @output_file_name min-scraper.js
	// @code_url http://phlip365.github.com/ScraperJS/scraper.js
	// @use_closure_library true
	// ==/ClosureCompiler==


Or use the following command line (assuming scaper.js is in a directory named scraperjs located at the same level as the closure-library directory):

	closure-library/closure/bin/build/closurebuilder.py 
	--root=closure-library/ 
	--root=scraperjs/ 
	--namespace="tmc.ScraperJS" 
	--output_mode=compiled 
	--compiler_jar=compiler.jar 
	--compiler_flags="--compilation_level=ADVANCED_OPTIMIZATIONS" 
	> scraperjs/min-scraper.js
