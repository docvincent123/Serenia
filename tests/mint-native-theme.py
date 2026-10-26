"""Parse the actual Linux client's CSS and apply it to real GTK widgets under Xvfb."""
import ast
from pathlib import Path
import gi
gi.require_version('Gtk','3.0')
from gi.repository import Gtk, Gdk
source=ast.parse(Path('installer/linux/solvia-linux-app.py').read_text())
styles=[node.args[0].value for node in ast.walk(source) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='load_from_data' and node.args and isinstance(node.args[0],ast.Constant)]
assert len(styles)==1
provider=Gtk.CssProvider();provider.load_from_data(styles[0])
window=Gtk.Window();window.get_style_context().add_class('solvia-native')
header=Gtk.HeaderBar(title='SOLVIA 3.1.0');window.set_titlebar(header)
Gtk.StyleContext.add_provider_for_screen(window.get_screen(),provider,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
window.show_all()
while Gtk.events_pending(): Gtk.main_iteration()
color=header.get_style_context().get_color(Gtk.StateFlags.NORMAL)
assert color.red>.9 and color.green>.9
background=header.get_style_context().get_background_color(Gtk.StateFlags.NORMAL)
assert abs(background.red-17/255)<.01 and abs(background.green-44/255)<.01 and abs(background.blue-43/255)<.01
window.destroy()
print('PASS: actual client theme parses in GTK3 and styles the native title bar with the motion palette')
