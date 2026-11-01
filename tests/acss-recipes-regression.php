<?php
namespace Automatic_CSS {
	class API {
		public static $recipes = array();
		public static function get_all_recipes() { return self::$recipes; }
	}
}
namespace Automatic_CSS\Model {
	class Generated_Inventory {
		public static $available = true;
		public static $variables = array('primary', 'primary-light');
		public static $throws = false;
		public function is_available() { if (self::$throws) { throw new \RuntimeException('Unavailable inventory'); } return self::$available; }
		public function get_variables() { return self::$variables; }
	}
}
namespace Automatic_CSS\Model\Config {
	class Framework {
		public static $variables = array('primary');
		public static $throws = false;
		public function get_variables($active) { if (!$active || self::$throws) { throw new \RuntimeException('Unavailable catalogue'); } return self::$variables; }
	}
}
namespace {
	function sanitize_key($name) { return preg_replace('/[^a-z0-9_\-]/', '', strtolower($name)); }
	$source = file_get_contents(__DIR__ . '/../uplink-css-studio.php');
	$methods = '';
	foreach (array('get_css_recipes','get_acss_recipe_variables','acss_color_recipe_is_available','normalize_variable_names') as $name) {
		$start = strpos($source, "\tprivate static function {$name}(");
		if (false === $start) { throw new RuntimeException('Missing method: '.$name); }
		preg_match('/\n\t(?:private|public) static function /', $source, $next, PREG_OFFSET_CAPTURE, $start + 1);
		$methods .= str_replace('private static function', 'public static function', substr($source, $start, $next[0][1] - $start));
	}
	eval('class RecipeHarness {'.$methods.'}');
	function verify($condition, $message) { if (!$condition) { throw new RuntimeException($message); } }
	$checks = 0;
	function check_recipe($name, $run) {
		global $checks;
		\Automatic_CSS\Model\Generated_Inventory::$available = true;
		\Automatic_CSS\Model\Generated_Inventory::$variables = array('primary','primary-light');
		\Automatic_CSS\Model\Generated_Inventory::$throws = false;
		\Automatic_CSS\Model\Config\Framework::$variables = array('primary');
		\Automatic_CSS\Model\Config\Framework::$throws = false;
		\Automatic_CSS\API::$recipes = array(
			'primary-clr'=>'oklch(from var(--primary) l c h / 1)',
			'primary-light-clr'=>'oklch(from var(--primary-light) l c h / 1)',
			'secondary-clr'=>'oklch(from var(--secondary) l c h / 1)',
			'grid-2'=>'display:grid; grid-template-columns:var(--grid-2);',
			'local'=>'%root% { --local: red; color:var(--local); }',
			'script'=>'<script>alert(1)</script>',
			'query'=>"return [\n 'post_type'=>'post'\n];"
		);
		$run(); $checks++; echo 'PASS '.$name."\n";
	}
	check_recipe('available colors and shades stay while disabled colors disappear', function() {
		$r=RecipeHarness::get_css_recipes(); verify(isset($r['primary-clr'],$r['primary-light-clr'])&&!isset($r['secondary-clr']),'Wrong color recipe availability');
	});
	check_recipe('layout recipes and locally defined variables are not filtered', function() {
		$r=RecipeHarness::get_css_recipes(); verify(isset($r['grid-2'],$r['local']),'Non-color recipes removed');
	});
	check_recipe('existing non-CSS recipe exclusions still apply', function() {
		$r=RecipeHarness::get_css_recipes(); verify(!isset($r['script'])&&!isset($r['query']),'Non-CSS recipe exposed');
	});
	check_recipe('generated inventory takes priority over a broader catalogue', function() {
		\Automatic_CSS\Model\Config\Framework::$variables[]='secondary';
		verify(!isset(RecipeHarness::get_css_recipes()['secondary-clr']),'Inactive catalogue color exposed');
	});
	check_recipe('older ACSS can use its active variable catalogue', function() {
		\Automatic_CSS\Model\Generated_Inventory::$available=false;
		$r=RecipeHarness::get_css_recipes();verify(isset($r['primary-clr'])&&!isset($r['primary-light-clr'])&&!isset($r['secondary-clr']),'Catalogue fallback failed');
	});
	check_recipe('unavailable inventory and catalogue preserve provider recipes', function() {
		\Automatic_CSS\Model\Generated_Inventory::$throws=true;\Automatic_CSS\Model\Config\Framework::$throws=true;
		verify(isset(RecipeHarness::get_css_recipes()['secondary-clr']),'Provider recipes lost on API failure');
	});
	check_recipe('empty generated inventory hides color recipes but keeps layouts', function() {
		\Automatic_CSS\Model\Generated_Inventory::$variables=array();
		$r=RecipeHarness::get_css_recipes();verify(!isset($r['primary-clr'])&&isset($r['grid-2']),'Empty inventory not respected');
	});
	check_recipe('availability changes are picked up without a Studio cache', function() {
		verify(!isset(RecipeHarness::get_css_recipes()['secondary-clr']),'Expected disabled color');
		\Automatic_CSS\Model\Generated_Inventory::$variables[]='secondary';
		verify(isset(RecipeHarness::get_css_recipes()['secondary-clr']),'Enabled color did not reappear');
	});
	check_recipe('a literal fallback keeps a color recipe usable', function() {
		\Automatic_CSS\API::$recipes['fallback-clr']='oklch(from var(--missing, red) l c h / 1)';
		verify(isset(RecipeHarness::get_css_recipes()['fallback-clr']),'Valid fallback removed');
	});
	echo $checks." ACSS recipe regression checks passed.\n";
}
