import importlib.util
import pathlib
import unittest
spec=importlib.util.spec_from_file_location('network',pathlib.Path(__file__).resolve().parents[1]/'installer/linux/network-address.py')
network=importlib.util.module_from_spec(spec);spec.loader.exec_module(network)
def interface(name,ip,state='UP'):
    return {'ifname':name,'operstate':state,'addr_info':[{'family':'inet','scope':'global','local':ip}]}
class Network(unittest.TestCase):
    def test_dhcp_change_discards_stale_address(self):
        self.assertEqual(network.select([interface('eth0','192.168.1.22')],[{'dst':'default','dev':'eth0'}],'192.168.1.10'),'192.168.1.22')
    def test_default_route_beats_container_network(self):
        self.assertEqual(network.select([interface('docker0','172.17.0.1'),interface('wlan0','10.2.3.4')],[{'dst':'default','dev':'wlan0'}]),'10.2.3.4')
    def test_current_explicit_address_is_preserved(self):
        self.assertEqual(network.select([interface('eth0','192.168.1.22'),interface('eth1','10.2.3.4')],[], '10.2.3.4'),'10.2.3.4')
    def test_no_private_active_address_fails(self):
        for interfaces in ([],[interface('eth0','8.8.8.8')],[interface('eth0','192.168.1.2','DOWN')]):
            with self.assertRaises(ValueError):network.select(interfaces,[])
if __name__=='__main__':unittest.main()
