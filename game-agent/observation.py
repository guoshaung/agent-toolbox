"""Only fresh evidence counts as detection; held positions are diagnostic data."""
def observed_target(target, frozen=False):
    return bool(target.found and not target.predicted and not frozen)


def live_backend(source, backend, window_title, focus_title, focus_mode):
    if source == 'screen' and not (
        window_title == 'AgentToolboxTestTarget'
        and focus_title == window_title and focus_mode == 'block'
    ):
        return 'null'
    return backend
